import type { BotBondEvent, ChainTx, Policy, ViewState } from "./types";

// The gateway decides. This file only renders what it was told.
// Never add a rule here that infers allow/deny on its own.

export const emptyView: ViewState = {
  sessionState: "CREATED",
  task: null,
  taskEn: null,
  policy: null,
  policyHash: null,
  excluded: [],
  explanation: [],
  compilerMeta: null,
  usageSpentAtomic: 0,
  usageCapAtomic: 0,
  usageSettled: false,
  paymentMode: null,
  bondAmountAtomic: 0,
  maxPenaltyAtomic: 0,
  penaltyAtomic: 0,
  bondRefundedAtomic: 0,
  bondPhase: "NONE",
  fixtureMode: false,
  reservation: null,
  trace: [],
  txs: [],
  deniedCount: 0,
  callCount: 0,
  receiptHash: null,
  outcome: null,
  lastBondDeltaWasZeroOnDenial: false,
};

const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const FAKE_MARKERS = new Set(["FAKE_COMPILER_FIXTURE", "FAKE_ADAPTER_FIXTURE"]);

function containsFakeMarker(value: unknown): boolean {
  if (typeof value === "string") return FAKE_MARKERS.has(value);
  if (Array.isArray(value)) return value.some(containsFakeMarker);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsFakeMarker);
  }
  return false;
}

function excludedFrom(data: Record<string, unknown>): ViewState["excluded"] {
  if (Array.isArray(data.excludedOperations)) {
    return data.excludedOperations.flatMap((entry) => {
      if (typeof entry === "string") return [{ path: entry, reason: "Excluded by compiled least-privilege policy" }];
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const path = str(record.path ?? record.pathTemplate);
      if (!path) return [];
      return [{ path, reason: str(record.reason) ?? "Excluded by compiled least-privilege policy" }];
    });
  }
  if (!Array.isArray(data.excludedPermissions)) return [];
  return data.excludedPermissions
    .filter((path): path is string => typeof path === "string")
    .map((path) => ({ path, reason: "Excluded by compiled least-privilege policy" }));
}

function pushTx(
  txs: ChainTx[],
  label: string,
  raw: unknown,
  fixtureMarker?: unknown,
): ChainTx[] {
  if (!raw || typeof raw !== "object") return txs;
  const t = raw as Record<string, unknown>;
  const signature = str(t.signature);
  if (!signature) return txs;
  const status = (str(t.status) ?? "PENDING") as ChainTx["status"];
  const fake = containsFakeMarker(fixtureMarker) || signature.startsWith("fake-");
  const next: ChainTx = {
    label,
    signature,
    status,
    cluster: str(t.cluster) ?? "devnet",
    slot: typeof t.slot === "number" ? t.slot : undefined,
    explorerEligible: !fake,
  };
  const existing = txs.findIndex((x) => x.signature === signature);
  if (existing >= 0) {
    const copy = [...txs];
    copy[existing] = { ...copy[existing], status, label: copy[existing].label };
    return copy;
  }
  return [...txs, next];
}

function pushProviderReference(
  txs: ChainTx[],
  label: string,
  data: Record<string, unknown>,
): ChainTx[] {
  const signature = str(data.providerReference);
  if (!signature) return txs;
  return pushTx(
    txs,
    label,
    { signature, status: data.status ?? "CONFIRMED", cluster: data.cluster ?? "devnet" },
    data.fixtureMarker,
  );
}

export function applyEvent(prev: ViewState, e: BotBondEvent): ViewState {
  const d = e.data;
  const s: ViewState = {
    ...prev,
    lastBondDeltaWasZeroOnDenial: false,
    fixtureMode: prev.fixtureMode || containsFakeMarker(d),
  };

  switch (e.type) {
    case "INTENT_RECEIVED": {
      s.task = str(d.task ?? d.purpose);
      s.taskEn = str(d.taskEn);
      const budget = d.budget as Record<string, unknown> | undefined;
      if (budget) {
        s.usageCapAtomic = num(budget.usageCapAtomic);
        s.bondAmountAtomic = num(budget.bondCapAtomic);
      }
      return s;
    }

    case "POLICY_COMPILED": {
      if (d.policy && typeof d.policy === "object") s.policy = d.policy as Policy;
      s.policyHash = str(d.policyHash);
      s.excluded = excludedFrom(d);
      const validationMetadata = d.validationMetadata && typeof d.validationMetadata === "object"
        ? d.validationMetadata as Record<string, unknown>
        : null;
      if (validationMetadata && containsFakeMarker(validationMetadata.fixtureMarker)) s.fixtureMode = true;
      s.explanation = (d.explanation as string[]) ?? [];
      s.compilerMeta = (d.compiler as ViewState["compilerMeta"]) ?? null;
      if (s.policy) {
        s.usageCapAtomic = num(s.policy.constraints.usageCapAtomic, s.usageCapAtomic);
        s.bondAmountAtomic = num(s.policy.constraints.bondAmountAtomic, s.bondAmountAtomic);
        s.maxPenaltyAtomic = num(s.policy.constraints.maxPenaltyAtomic);
      }
      s.sessionState = "POLICY_READY";
      return s;
    }

    case "PAYMENT_VERIFIED": {
      s.paymentMode = str(d.mode);
      s.usageCapAtomic = num(d.usageCapAtomic, s.usageCapAtomic);
      s.sessionState = "PAYMENT_READY";
      return s;
    }

    case "BOND_OPENED": {
      s.bondAmountAtomic = num(d.bondAmountAtomic, s.bondAmountAtomic);
      s.maxPenaltyAtomic = num(d.maxPenaltyAtomic, s.maxPenaltyAtomic);
      s.bondPhase = "LOCKED";
      s.sessionState = "BONDED";
      s.txs = pushTx(s.txs, "Bond locked", d.transaction, d.fixtureMarker);
      s.txs = pushProviderReference(s.txs, "Bond locked", d);
      return s;
    }

    case "SESSION_ACTIVATED": {
      s.sessionState = "ACTIVE";
      if (s.reservation?.expiresAt) {
        s.reservation = {
          ...s.reservation,
          secondsRemaining: Math.max(
            0,
            Math.ceil((new Date(s.reservation.expiresAt).getTime() - new Date(e.occurredAt).getTime()) / 1000),
          ),
        };
      }
      return s;
    }

    case "REQUEST_ALLOWED": {
      s.callCount = typeof d.callIndex === "number" ? d.callIndex : s.callCount + 1;
      s.usageSpentAtomic = d.usageSpentAtomic === undefined
        ? s.usageSpentAtomic + num(d.chargedAtomic)
        : num(d.usageSpentAtomic);
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "ALLOWED",
          method: str(d.method) ?? "GET",
          path: str(d.path) ?? "",
          headline: "Allowed",
          detail: ((d.returnedFields as string[]) ?? []).join(" · "),
          bondUnchanged: true,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "REQUEST_DENIED": {
      const phase = str(d.phase);
      const preSession = phase === "PRE_SESSION" || (phase === null && prev.sessionState !== "ACTIVE");
      s.deniedCount = preSession ? s.deniedCount : s.deniedCount + 1;
      s.lastBondDeltaWasZeroOnDenial = !preSession;
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "DENIED",
          method: str(d.method) ?? "GET",
          path: str(d.path) ?? "",
          headline: preSession ? "No session" : "Denied",
          detail: str(d.reasonText) ?? str(d.reason) ?? undefined,
          bondUnchanged: true,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "RESERVATION_CREATED": {
      // Legacy rich fixtures may contain synthetic tick events. Ignore them: playback
      // derives remaining TTL from event timestamps, and live mode uses wall clock.
      if (d.tick === true) return s;
      const expiresAt = str(d.expiresAt);
      const eventTimeMs = new Date(e.occurredAt).getTime();
      const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
      const ttlSeconds = d.ttlSeconds === undefined && Number.isFinite(expiresAtMs) && Number.isFinite(eventTimeMs)
        ? Math.max(0, Math.ceil((expiresAtMs - eventTimeMs) / 1000))
        : num(d.ttlSeconds, 60);
      s.callCount = num(d.callIndex, s.callCount);
      s.reservation = {
        id: str(d.reservationId) ?? "rsv",
        productId: str(d.productId) ?? "",
        ttlSeconds,
        expiresAt,
        secondsRemaining: ttlSeconds,
        status: "HELD",
      };
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "RESERVATION",
          method: "POST",
          path: "/reservations",
          headline: "Held",
          detail: `${str(d.productId) ?? ""} · ${ttlSeconds}s · bonded action`,
          bondUnchanged: true,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "RESERVATION_RELEASED":
    case "RESERVATION_CONSUMED": {
      const released = e.type === "RESERVATION_RELEASED";
      s.callCount = num(d.callIndex, s.callCount);
      s.reservation = s.reservation
        ? { ...s.reservation, status: released ? "RELEASED" : "CONSUMED", secondsRemaining: null }
        : null;
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "RESERVATION",
          method: "POST",
          path: "/reservations",
          headline: released ? "Released" : "Purchased",
          detail: "Inventory restored · no penalty condition",
          bondUnchanged: true,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "RESERVATION_EXPIRED": {
      s.reservation = s.reservation
        ? { ...s.reservation, status: "EXPIRED", secondsRemaining: 0 }
        : null;
      s.sessionState = "EXPIRED";
      if (s.bondPhase !== "RETURNED") s.bondPhase = "SETTLING";
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "RESERVATION",
          method: "TTL",
          path: "/reservations",
          headline: "Expired",
          detail: str(d.reasonText) ?? "TTL elapsed without release",
          bondUnchanged: false,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "USAGE_SETTLED": {
      s.usageSpentAtomic = num(d.usageChargedAtomic, s.usageSpentAtomic);
      s.callCount = num(d.calls, s.callCount);
      s.usageSettled = true;
      if (s.sessionState === "EXPIRED") s.outcome = "EXPIRED";
      s.callCount = num(d.calls, s.callCount);
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "SETTLEMENT",
          headline: "Usage settled",
          detail: `pay.sh · ${num(d.calls)} calls`,
          bondUnchanged: true,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "PENALTY_SETTLED": {
      s.penaltyAtomic = num(d.penaltyAtomic);
      s.maxPenaltyAtomic = num(d.maxPenaltyAtomic, s.maxPenaltyAtomic);
      if (d.bondRefundedAtomic !== undefined) {
        s.bondRefundedAtomic = num(d.bondRefundedAtomic);
        s.bondPhase = "RETURNED";
      } else {
        s.bondPhase = "SETTLING";
      }
      s.txs = pushTx(s.txs, "Bounded settlement", d.transaction, d.fixtureMarker);
      s.txs = pushProviderReference(s.txs, "Bounded settlement", d);
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "SETTLEMENT",
          headline: "Bounded settlement",
          detail: str(d.note) ?? "Objective cause only",
          bondUnchanged: false,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "BOND_REFUNDED": {
      s.bondRefundedAtomic = num(d.refundedAtomic ?? d.bondRefundedAtomic);
      s.penaltyAtomic = num(d.penaltyAtomic, s.penaltyAtomic);
      s.bondPhase = "RETURNED";
      s.txs = pushTx(s.txs, "Bond returned", d.transaction, d.fixtureMarker);
      s.txs = pushProviderReference(s.txs, "Bond returned", d);
      s.trace = [
        ...s.trace,
        {
          id: e.eventId,
          kind: "SETTLEMENT",
          headline: "Bond returned",
          detail: str(d.reason) ?? undefined,
          bondUnchanged: false,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "SESSION_CLOSED": {
      s.outcome = (str(d.outcome) as ViewState["outcome"]) ??
        (s.penaltyAtomic > 0 ? "VIOLATED" : "CLOSED");
      s.receiptHash = str(d.receiptHash);
      s.sessionState = s.outcome === "VIOLATED" ? "VIOLATED" : "CLOSED";
      return s;
    }

    default:
      return s;
  }
}

export function replay(events: BotBondEvent[], upto: number): ViewState {
  // `upto` can briefly exceed the list while a new fixture is being swapped in.
  const end = Math.max(0, Math.min(upto, events.length));
  let s = emptyView;
  for (let i = 0; i < end; i += 1) {
    const e = events[i];
    if (!e) break;
    s = applyEvent(s, e);
  }
  return s;
}
