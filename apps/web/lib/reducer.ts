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

function pushTx(txs: ChainTx[], label: string, raw: unknown): ChainTx[] {
  if (!raw || typeof raw !== "object") return txs;
  const t = raw as Record<string, unknown>;
  const signature = str(t.signature);
  if (!signature) return txs;
  const status = (str(t.status) ?? "PENDING") as ChainTx["status"];
  const next: ChainTx = {
    label,
    signature,
    status,
    cluster: str(t.cluster) ?? "devnet",
    slot: typeof t.slot === "number" ? t.slot : undefined,
  };
  const existing = txs.findIndex((x) => x.signature === signature);
  if (existing >= 0) {
    const copy = [...txs];
    copy[existing] = { ...copy[existing], status, label: copy[existing].label };
    return copy;
  }
  return [...txs, next];
}

export function applyEvent(prev: ViewState, e: BotBondEvent): ViewState {
  const d = e.data;
  const s: ViewState = { ...prev, lastBondDeltaWasZeroOnDenial: false };

  switch (e.type) {
    case "INTENT_RECEIVED": {
      s.task = str(d.task);
      s.taskEn = str(d.taskEn);
      const budget = d.budget as Record<string, unknown> | undefined;
      if (budget) {
        s.usageCapAtomic = num(budget.usageCapAtomic);
        s.bondAmountAtomic = num(budget.bondCapAtomic);
      }
      return s;
    }

    case "POLICY_COMPILED": {
      s.policy = (d.policy as unknown as Policy) ?? null;
      s.policyHash = str(d.policyHash);
      s.excluded = (d.excludedOperations as ViewState["excluded"]) ?? [];
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
      s.txs = pushTx(s.txs, "Bond locked", d.transaction);
      return s;
    }

    case "SESSION_ACTIVATED": {
      s.sessionState = "ACTIVE";
      return s;
    }

    case "REQUEST_ALLOWED": {
      s.callCount = num(d.callIndex, s.callCount + 1);
      s.usageSpentAtomic = num(d.usageSpentAtomic, s.usageSpentAtomic + num(d.chargedAtomic));
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
      const preSession = d.phase === "PRE_SESSION";
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
      if (d.tick === true) {
        s.reservation = s.reservation
          ? { ...s.reservation, secondsRemaining: num(d.secondsRemaining) }
          : null;
        return s;
      }
      s.reservation = {
        id: str(d.reservationId) ?? "rsv",
        productId: str(d.productId) ?? "",
        ttlSeconds: num(d.ttlSeconds, 60),
        secondsRemaining: num(d.ttlSeconds, 60),
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
          detail: `${str(d.productId) ?? ""} · ${num(d.ttlSeconds, 60)}s · bonded action`,
          bondUnchanged: true,
          at: e.occurredAt,
        },
      ];
      return s;
    }

    case "RESERVATION_RELEASED":
    case "RESERVATION_CONSUMED": {
      const released = e.type === "RESERVATION_RELEASED";
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
      s.bondPhase = "SETTLING";
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
      s.usageSettled = true;
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
      s.bondPhase = "SETTLING";
      s.txs = pushTx(s.txs, "Bounded settlement", d.transaction);
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
      s.bondRefundedAtomic = num(d.refundedAtomic);
      s.penaltyAtomic = num(d.penaltyAtomic, s.penaltyAtomic);
      s.bondPhase = "RETURNED";
      s.txs = pushTx(s.txs, "Bond returned", d.transaction);
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
      s.outcome = str(d.outcome);
      s.receiptHash = str(d.receiptHash);
      s.sessionState = d.outcome === "VIOLATED" ? "VIOLATED" : "CLOSED";
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
