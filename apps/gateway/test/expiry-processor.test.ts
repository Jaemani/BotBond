import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeBondAdapter, FakePaymentAdapter } from "../src/adapters.js";
import { ManualClock } from "../src/clock.js";
import { DemoCommerceApi } from "../src/commerce.js";
import { processExpiredReservations } from "../src/expiry-processor.js";
import { InMemoryRepository, type SessionRecord } from "../src/repository.js";
import type { AccessPolicy, BotBondEvent } from "@botbond/contracts";

const policy: AccessPolicy = {
  version: "botbond-policy/v1",
  policyId: "pol_worker",
  merchantId: "demo-commerce",
  agentWallet: "worker-wallet",
  purpose: "Reserve one laptop",
  allowedOperations: [{ method: "POST", pathTemplate: "/reservations", allowedResponseFields: ["reservationId"], maxCalls: 1 }],
  constraints: { maxTotalCalls: 1, maxRequestsPerMinute: 1, expiresAt: "2026-08-02T12:05:00.000Z", usageCapAtomic: "200000", bondAmountAtomic: "1000000", maxPenaltyAtomic: "200000" },
  bondedActions: [{ operationId: "reserve-inventory", maxActive: 1, ttlSeconds: 60, expiryPenaltyAtomic: "200000" }],
  settlement: { validClose: "REFUND_BOND", scopeViolation: "BOUNDED_PENALTY_AND_REFUND_REMAINDER", expiry: "RECLAIM_AFTER_GRACE_PERIOD" },
  catalogVersion: "merchant-catalog/v1",
};

describe("reservation expiry processor", () => {
  it("recovers an expired reservation after a stale settlement lease", async () => {
    const repository = new InMemoryRepository();
    const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
    const commerce = new DemoCommerceApi(repository, clock);
    await commerce.initialize();
    const session: SessionRecord = { sessionId: "ses_worker_recovery", intentId: "int_worker", policy, policyHash: "sha256:worker", state: "ACTIVE", expiresAt: policy.constraints.expiresAt, calls: 1, operationCalls: {}, requestTimestamps: [], traceId: "tr_worker_recovery", bondReference: "bond-worker" };
    await repository.saveSession(session);
    await commerce.createReservation(session.sessionId, "lap-1", 1, 60);
    clock.advance(60_001);
    await repository.claimSettlement(session.sessionId, clock.now(), 30_000);
    clock.advance(30_001);

    const events: BotBondEvent[] = [];
    const result = await processExpiredReservations({
      repository,
      commerce,
      payment: new FakePaymentAdapter(),
      bond: new FakeBondAdapter(),
      clock,
      async emit(event: Omit<BotBondEvent, "eventId" | "occurredAt">) {
        const full = { ...event, eventId: `evt_${randomUUID()}`, occurredAt: clock.now().toISOString() };
        events.push(full);
        await repository.appendEvent(full);
      },
    });

    expect(result[0]?.status).toBe("EXPIRED");
    expect((await repository.getSession(session.sessionId))?.state).toBe("EXPIRED");
    expect(events.map((event) => event.type)).toEqual(["RESERVATION_EXPIRED", "PENALTY_SETTLED", "USAGE_SETTLED", "SESSION_CLOSED"]);
    expect(events.at(-1)?.data.receiptHash).toMatch(/^sha256:/);
  });

  it("finds expired reservations, restores inventory, settles, and is idempotent", async () => {
    const repository = new InMemoryRepository();
    const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
    const commerce = new DemoCommerceApi(repository, clock);
    await commerce.initialize();
    const session: SessionRecord = { sessionId: "ses_worker", intentId: "int_worker", policy, policyHash: "sha256:worker", state: "ACTIVE", expiresAt: policy.constraints.expiresAt, calls: 1, operationCalls: {}, requestTimestamps: [], traceId: "tr_worker", bondReference: "bond-worker" };
    await repository.saveSession(session);
    const before = (await commerce.getInventory("lap-1")).stock;
    await commerce.createReservation(session.sessionId, "lap-1", 1, 60);
    clock.advance(60_001);
    const events: BotBondEvent[] = [];
    const dependencies = {
      repository,
      commerce,
      payment: new FakePaymentAdapter(),
      bond: new FakeBondAdapter(),
      clock,
      async emit(event: Omit<BotBondEvent, "eventId" | "occurredAt">) {
        const full = { ...event, eventId: `evt_${randomUUID()}`, occurredAt: clock.now().toISOString() };
        events.push(full);
        await repository.appendEvent(full);
      },
    };
    const first = await processExpiredReservations(dependencies);
    const second = await processExpiredReservations(dependencies);
    expect(first[0]?.status).toBe("EXPIRED");
    expect(second).toEqual([]);
    expect((await commerce.getInventory("lap-1")).stock).toBe(before);
    expect((await repository.getSession(session.sessionId))?.state).toBe("EXPIRED");
    expect(events.map((event) => event.type)).toEqual(["RESERVATION_EXPIRED", "PENALTY_SETTLED", "USAGE_SETTLED", "SESSION_CLOSED"]);
    expect(events.at(-1)?.data.receiptHash).toMatch(/^sha256:/);
    const attempts = await repository.listSettlementAttempts(session.sessionId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptId: `expiry:${session.sessionId}:res_${session.sessionId}_lap-1`,
      outcome: "EXPIRED_RESERVATION",
      status: "CONFIRMED",
      retryable: false,
      providerReference: `fake-bond-expiry:${session.sessionId}`,
    });
    expect(attempts[0]?.evidence.reservationId)
      .toBe(`res_${session.sessionId}_lap-1`);
  });
});
