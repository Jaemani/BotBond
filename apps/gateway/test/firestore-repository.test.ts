import { randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirestoreRepository } from "../src/firestore-repository.js";
import type { SessionRecord } from "../src/repository.js";
import type { AccessPolicy, BotBondEvent } from "@botbond/contracts";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulator ? describe : describe.skip;
const namespace = `botbond_test_${randomUUID().replaceAll("-", "")}`;
const firestore = new Firestore({ projectId: "botbond-test" });
const repository = new FirestoreRepository(firestore, namespace);

const policy: AccessPolicy = {
  version: "botbond-policy/v1", policyId: "pol_firestore", merchantId: "demo-commerce", agentWallet: "wallet", purpose: "test",
  allowedOperations: [{ method: "GET", pathTemplate: "/products", allowedResponseFields: ["id"], maxCalls: 1 }],
  constraints: { maxTotalCalls: 1, maxRequestsPerMinute: 1, expiresAt: "2026-08-02T12:05:00.000Z", usageCapAtomic: "1", bondAmountAtomic: "0", maxPenaltyAtomic: "0" },
  bondedActions: [], settlement: { validClose: "REFUND_BOND", scopeViolation: "BOUNDED_PENALTY_AND_REFUND_REMAINDER", expiry: "RECLAIM_AFTER_GRACE_PERIOD" }, catalogVersion: "merchant-catalog/v1",
};
const session: SessionRecord = { sessionId: "ses_firestore", intentId: "int_firestore", policy, policyHash: "sha256:firestore", state: "CREATED", expiresAt: policy.constraints.expiresAt, calls: 0, operationCalls: {}, requestTimestamps: [], traceId: "tr_firestore" };

describeEmulator("FirestoreRepository emulator contract", () => {
  beforeAll(async () => {
    await repository.saveIntent({ intentId: "int_firestore", policy, policyHash: "sha256:firestore", explanation: ["test"], excludedPermissions: [] });
    await repository.saveSession(session);
  });
  afterAll(async () => {
    await firestore.terminate();
  });

  it("round-trips records and orders events", async () => {
    expect((await repository.getIntent("int_firestore"))?.policyHash).toBe("sha256:firestore");
    const events: BotBondEvent[] = [
      { eventId: "evt_2", sessionId: session.sessionId, occurredAt: "2026-08-02T12:00:02.000Z", type: "SESSION_ACTIVATED", data: {}, traceId: session.traceId },
      { eventId: "evt_1", sessionId: session.sessionId, occurredAt: "2026-08-02T12:00:01.000Z", type: "PAYMENT_VERIFIED", data: {}, traceId: session.traceId },
    ];
    for (const event of events) await repository.appendEvent(event);
    expect((await repository.listEvents(session.sessionId)).map((event) => event.eventId)).toEqual(["evt_1", "evt_2"]);
  });

  it("enforces expected state transactionally", async () => {
    expect((await repository.transitionSession(session.sessionId, "CREATED", "POLICY_READY")).state).toBe("POLICY_READY");
    await expect(repository.transitionSession(session.sessionId, "CREATED", "POLICY_READY")).rejects.toThrow("INVALID_STATE_TRANSITION");
  });

  it("claims idempotency atomically and rejects conflicting fingerprints", async () => {
    const first = await repository.claimIdempotent("claim", "key", "fingerprint-one");
    expect(first).toEqual({ status: "CLAIMED" });
    expect(await repository.claimIdempotent("claim", "key", "fingerprint-one")).toEqual({ status: "IN_PROGRESS" });
    expect(await repository.claimIdempotent("claim", "key", "fingerprint-two")).toEqual({ status: "CONFLICT" });
    await repository.completeIdempotent("claim", "key", "fingerprint-one", { sessionId: "one" });
    expect(await repository.claimIdempotent("claim", "key", "fingerprint-one")).toEqual({ status: "COMPLETED", value: { sessionId: "one" } });
  });

  it("reserves request counters atomically", async () => {
    const requestSession = { ...session, sessionId: "ses_requests", state: "ACTIVE" as const };
    await repository.saveSession(requestSession);
    const results = await Promise.allSettled([
      repository.reserveRequest(requestSession.sessionId, { operationKey: "GET:/products", operationMaxCalls: 1, maxTotalCalls: 1, maxRequestsPerMinute: 1, nowMs: 1_000 }),
      repository.reserveRequest(requestSession.sessionId, { operationKey: "GET:/products", operationMaxCalls: 1, maxTotalCalls: 1, maxRequestsPerMinute: 1, nowMs: 1_000 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.getSession(requestSession.sessionId))?.calls).toBe(1);
  });

  it("updates inventory and enforces one active reservation transactionally", async () => {
    const now = "2026-08-02T12:00:00.000Z";
    await repository.putInventoryIfAbsent({ productId: "lap-firestore", stock: 2, updatedAt: now });
    const first = { reservationId: "res_firestore_one", sessionId: "ses_inventory", productId: "lap-firestore", quantity: 1, createdAt: now, expiresAt: "2026-08-02T12:01:00.000Z", state: "ACTIVE" as const, settlementRequested: false };
    const second = { ...first, reservationId: "res_firestore_two" };
    await repository.createReservationWithInventory(first);
    expect((await repository.getInventory(first.productId))?.stock).toBe(1);
    await expect(repository.createReservationWithInventory(second)).rejects.toThrow("MAX_ACTIVE_RESERVATIONS");
    const released = await repository.finalizeReservationWithInventory(first.sessionId, first.reservationId, "RELEASED", Date.parse("2026-08-02T12:00:30.000Z"));
    expect(released.changed).toBe(true);
    expect((await repository.getInventory(first.productId))?.stock).toBe(2);
    await repository.createReservationWithInventory(second);
    expect((await repository.getInventory(first.productId))?.stock).toBe(1);
  });
});
