import { describe, expect, it } from "vitest";
import { applyEvent, emptyView, replay } from "./reducer";
import type { BotBondEvent } from "./types";

const event = (
  type: BotBondEvent["type"],
  data: Record<string, unknown>,
  occurredAt = "2026-08-21T10:00:00Z",
): BotBondEvent => ({
  eventId: `evt-${type}-${occurredAt}`,
  sessionId: "ses-test",
  occurredAt,
  type,
  data,
  traceId: "trace-test",
});

describe("Role A/B event compatibility", () => {
  it("accepts canonical excludedPermissions and rich excludedOperations", () => {
    const rich = applyEvent(emptyView, event("POLICY_COMPILED", {
      excludedOperations: [{ path: "/users", reason: "Outside purpose" }],
    }));
    expect(rich.excluded).toEqual([{ path: "/users", reason: "Outside purpose" }]);

    const canonical = applyEvent(emptyView, event("POLICY_COMPILED", {
      excludedPermissions: ["/seller-contacts"],
    }));
    expect(canonical.excluded).toEqual([{
      path: "/seller-contacts",
      reason: "Excluded by compiled least-privilege policy",
    }]);
  });

  it("infers missing denial phase from session lifecycle", () => {
    const preSession = applyEvent(emptyView, event("REQUEST_DENIED", { reason: "SESSION_NOT_FOUND" }));
    expect(preSession.deniedCount).toBe(0);
    expect(preSession.trace[0]?.headline).toBe("No session");
    expect(preSession.lastBondDeltaWasZeroOnDenial).toBe(false);

    const active = { ...emptyView, sessionState: "ACTIVE" as const };
    const inSession = applyEvent(active, event("REQUEST_DENIED", { reason: "OPERATION_NOT_ALLOWED" }));
    expect(inSession.deniedCount).toBe(1);
    expect(inSession.trace[0]?.headline).toBe("Denied");
    expect(inSession.lastBondDeltaWasZeroOnDenial).toBe(true);
  });

  it("does not regress an active session when confirmed bond evidence arrives later", () => {
    const state = replay([
      event("BOND_OPENED", { status: "CONFIRMED", bondAccount: "bond-1" }),
      event("SESSION_ACTIVATED", { expiresAt: "2026-08-21T10:05:00Z" }, "2026-08-21T10:00:01Z"),
      event("BOND_OPENED", {
        status: "CONFIRMED",
        transaction: { signature: "5RealSolanaSignature", status: "CONFIRMED", cluster: "devnet" },
      }, "2026-08-21T10:00:02Z"),
      event("REQUEST_DENIED", { method: "GET", path: "/seller-contacts", reason: "OPERATION_NOT_ALLOWED" }, "2026-08-21T10:00:03Z"),
    ], 4);
    expect(state.sessionState).toBe("ACTIVE");
    expect(state.deniedCount).toBe(1);
    expect(state.trace.at(-1)?.headline).toBe("Denied");
  });

  it("accumulates canonical per-call charges when usage total is absent", () => {
    const state = replay([
      event("REQUEST_ALLOWED", { chargedAtomic: "1000" }),
      event("REQUEST_ALLOWED", { chargedAtomic: "1000" }, "2026-08-21T10:00:01Z"),
    ], 2);
    expect(state.usageSpentAtomic).toBe(2000);
    expect(state.callCount).toBe(2);
  });

  it("derives reservation TTL from timestamps and ignores synthetic ticks", () => {
    const created = applyEvent(emptyView, event("RESERVATION_CREATED", {
      reservationId: "rsv-1",
      productId: "p-1",
      expiresAt: "2026-08-21T10:01:00Z",
    }));
    expect(created.reservation?.ttlSeconds).toBe(60);
    expect(created.reservation?.secondsRemaining).toBe(60);

    const tick = applyEvent(created, event("RESERVATION_CREATED", {
      tick: true,
      secondsRemaining: 1,
    }, "2026-08-21T10:00:30Z"));
    expect(tick.reservation?.secondsRemaining).toBe(60);
  });

  it("shows fixture mode only for known markers and never links fake references", () => {
    const unmarked = applyEvent(emptyView, event("PAYMENT_VERIFIED", { status: "CONFIRMED" }));
    expect(unmarked.fixtureMode).toBe(false);

    const marked = applyEvent(unmarked, event("BOND_OPENED", {
      status: "CONFIRMED",
      providerReference: "fake-bond:ses-test",
      fixtureMarker: "FAKE_ADAPTER_FIXTURE",
    }));
    expect(marked.fixtureMode).toBe(true);
    expect(marked.txs[0]?.explorerEligible).toBe(false);

    const real = applyEvent(emptyView, event("BOND_OPENED", {
      status: "CONFIRMED",
      providerReference: "5RealSolanaSignature",
    }));
    expect(real.fixtureMode).toBe(false);
    expect(real.txs[0]?.explorerEligible).toBe(true);
  });
});
