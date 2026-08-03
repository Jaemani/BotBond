import { randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirestoreRepository } from "../src/firestore-repository.js";
import { createSettlementEvidence } from "../src/settlement-evidence.js";
import type { SessionRecord, SettlementAttemptRecord } from "../src/repository.js";
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
      repository.reserveRequest(requestSession.sessionId, { operationKey: "GET:/products", operationMaxCalls: 1, maxTotalCalls: 1, maxRequestsPerMinute: 1, nowMs: 1_000, expectedState: "ACTIVE" }),
      repository.reserveRequest(requestSession.sessionId, { operationKey: "GET:/products", operationMaxCalls: 1, maxTotalCalls: 1, maxRequestsPerMinute: 1, nowMs: 1_000, expectedState: "ACTIVE" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.getSession(requestSession.sessionId))?.calls).toBe(1);
  }, 15_000);

  it("rejects request reservations after settlement lock", async () => {
    const requestSession = { ...session, sessionId: "ses_settling_request", state: "SETTLING" as const };
    await repository.saveSession(requestSession);
    await expect(repository.reserveRequest(requestSession.sessionId, {
      operationKey: "GET:/products",
      operationMaxCalls: 1,
      maxTotalCalls: 1,
      maxRequestsPerMinute: 1,
      nowMs: 1_000,
      expectedState: "ACTIVE",
    })).rejects.toThrow("SESSION_NOT_ACTIVE");
    expect((await repository.getSession(requestSession.sessionId))?.calls).toBe(0);
  });

  it("creates sessions atomically and deletes only pre-activation states", async () => {
    const pending = { ...session, sessionId: "ses_atomic_create" };
    expect(await repository.createSession(pending)).toBe(true);
    expect(await repository.createSession(pending)).toBe(false);
    await repository.appendEvent({
      eventId: "evt_atomic_create",
      sessionId: pending.sessionId,
      occurredAt: "2026-08-02T12:00:00.000Z",
      type: "PAYMENT_VERIFIED",
      data: {},
      traceId: pending.traceId,
    });
    expect(await repository.deleteSessionIfState(pending.sessionId, ["CREATED", "POLICY_READY", "PAYMENT_READY", "BONDED"])).toBe(true);
    expect(await repository.getSession(pending.sessionId)).toBeUndefined();
    expect(await repository.listEvents(pending.sessionId)).toEqual([]);

    const active = { ...pending, sessionId: "ses_atomic_active", state: "ACTIVE" as const };
    expect(await repository.createSession(active)).toBe(true);
    expect(await repository.deleteSessionIfState(active.sessionId, ["CREATED", "POLICY_READY", "PAYMENT_READY", "BONDED"])).toBe(false);
  });

  it("atomically preserves one settlement evidence identity", async () => {
    const makeAttempt = (nonce: string, issuedAt: string): SettlementAttemptRecord => ({
      attemptId: "close:ses_firestore_attempt",
      sessionId: "ses_firestore_attempt",
      outcome: "VALID_CLOSE",
      evidence: createSettlementEvidence({
        sessionId: "ses_firestore_attempt",
        policyHash: "sha256:firestore",
        outcome: "VALID_CLOSE",
        usageChargedAtomic: "1000",
        penaltyAtomic: "0",
        bondRefundedAtomic: "1000000",
        nonce,
        issuedAt,
        authority: "firestore-test",
      }, "test-secret"),
      status: "PENDING",
      retryable: true,
      startedAt: issuedAt,
      updatedAt: issuedAt,
    });

    const [first, second] = await Promise.all([
      repository.createSettlementAttempt(
        makeAttempt("first", "2026-08-02T12:00:00.000Z"),
      ),
      repository.createSettlementAttempt(
        makeAttempt("second", "2026-08-02T12:00:01.000Z"),
      ),
    ]);

    expect(first.evidence.evidenceHash).toBe(second.evidence.evidenceHash);
    expect(first.evidence.issuedAt).toBe(second.evidence.issuedAt);
    expect(await repository.listSettlementAttempts("ses_firestore_attempt"))
      .toHaveLength(1);
  });

  it("enforces durable settlement nonce uniqueness across instances", async () => {
    const secondRepository = new FirestoreRepository(firestore, namespace);
    const results = await Promise.all([
      repository.claimSettlementNonce("nonce-firestore", "sha256:first"),
      secondRepository.claimSettlementNonce("nonce-firestore", "sha256:second"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repository.claimSettlementNonce("nonce-firestore", "sha256:first"))
      .toBe(results[0]);
    expect(await repository.claimSettlementNonce("nonce-firestore", "sha256:second"))
      .toBe(results[1]);
  }, 15_000);

  it("claims settlement leases atomically and permits stale recovery", async () => {
    const secondRepository = new FirestoreRepository(firestore, namespace);
    const settlingSession = {
      ...session,
      sessionId: "ses_settlement_lease",
      state: "ACTIVE" as const,
    };
    await repository.saveSession(settlingSession);
    const now = new Date("2026-08-02T12:00:00.000Z");

    const claims = await Promise.all([
      repository.claimSettlement(settlingSession.sessionId, now, 30_000),
      secondRepository.claimSettlement(settlingSession.sessionId, now, 30_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await repository.claimSettlement(
      settlingSession.sessionId,
      new Date("2026-08-02T12:00:29.999Z"),
      30_000,
    )).toBeUndefined();
    expect(await repository.claimSettlement(
      settlingSession.sessionId,
      new Date("2026-08-02T12:00:30.001Z"),
      30_000,
    )).toMatchObject({ state: "SETTLING" });
  }, 15_000);

  it("prevents concurrent settlement updates from regressing confirmation", async () => {
    const secondRepository = new FirestoreRepository(firestore, namespace);
    const attempt: SettlementAttemptRecord = {
      attemptId: "close:ses_firestore_update_race",
      sessionId: "ses_firestore_update_race",
      outcome: "VALID_CLOSE",
      evidence: createSettlementEvidence({
        sessionId: "ses_firestore_update_race",
        policyHash: "sha256:firestore",
        outcome: "VALID_CLOSE",
        usageChargedAtomic: "1000",
        penaltyAtomic: "0",
        bondRefundedAtomic: "1000000",
        nonce: "update-race",
        issuedAt: "2026-08-02T12:00:00.000Z",
        authority: "firestore-test",
      }, "test-secret"),
      status: "PENDING",
      retryable: true,
      startedAt: "2026-08-02T12:00:00.000Z",
      updatedAt: "2026-08-02T12:00:00.000Z",
    };
    await repository.createSettlementAttempt(attempt);

    await Promise.all([
      repository.saveSettlementAttempt({
        ...attempt,
        status: "CONFIRMED",
        retryable: false,
        providerReference: "tx:confirmed",
        updatedAt: "2026-08-02T12:00:01.000Z",
      }),
      secondRepository.saveSettlementAttempt({
        ...attempt,
        status: "PENDING",
        retryable: true,
        failureCode: "CONFIRMATION_PENDING",
        updatedAt: "2026-08-02T12:00:02.000Z",
      }),
    ]);

    const persisted = await repository.getSettlementAttempt(attempt.attemptId);
    expect(persisted).toMatchObject({
      status: "CONFIRMED",
      retryable: false,
      providerReference: "tx:confirmed",
      updatedAt: "2026-08-02T12:00:01.000Z",
    });
    expect(persisted?.failureCode).toBeUndefined();
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
