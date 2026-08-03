import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/clock.js";
import { InMemoryRepository } from "../src/repository.js";
import {
  claimSettlementEvidenceNonce,
  getOrCreateSettlementAttempt,
  updateSettlementAttempt,
} from "../src/settlement-attempt.js";
import { createSettlementEvidence } from "../src/settlement-evidence.js";

function evidence(issuedAt: string, nonce: string) {
  return createSettlementEvidence({
    sessionId: "ses_attempt",
    policyHash: "sha256:policy",
    outcome: "VALID_CLOSE",
    usageChargedAtomic: "1000",
    penaltyAtomic: "0",
    bondRefundedAtomic: "1000000",
    nonce,
    issuedAt,
    authority: "gateway-test",
  }, "test-secret");
}

describe("settlement attempt journal", () => {
  it("creates one stable evidence record under concurrent retries", async () => {
    const repository = new InMemoryRepository();
    const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
    const firstEvidence = evidence("2026-08-02T12:00:00.000Z", "first");
    const secondEvidence = evidence("2026-08-02T12:00:01.000Z", "second");

    const [first, second] = await Promise.all([
      getOrCreateSettlementAttempt(repository, clock, {
        attemptId: "close:ses_attempt",
        sessionId: "ses_attempt",
        outcome: "VALID_CLOSE",
        evidence: firstEvidence,
      }),
      getOrCreateSettlementAttempt(repository, clock, {
        attemptId: "close:ses_attempt",
        sessionId: "ses_attempt",
        outcome: "VALID_CLOSE",
        evidence: secondEvidence,
      }),
    ]);

    expect(first.evidence.evidenceHash).toBe(second.evidence.evidenceHash);
    expect(first.evidence.issuedAt).toBe(second.evidence.issuedAt);
    expect(await repository.listSettlementAttempts("ses_attempt")).toHaveLength(1);
  });

  it("permits one evidence identity per nonce across attempts", async () => {
    const repository = new InMemoryRepository();
    const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
    const first = await getOrCreateSettlementAttempt(repository, clock, {
      attemptId: "close:ses_nonce_one",
      sessionId: "ses_nonce_one",
      outcome: "VALID_CLOSE",
      evidence: evidence("2026-08-02T12:00:00.000Z", "shared-nonce"),
    });
    await claimSettlementEvidenceNonce(repository, first);
    await expect(claimSettlementEvidenceNonce(repository, first)).resolves.toBeUndefined();

    const second = await getOrCreateSettlementAttempt(repository, clock, {
      attemptId: "close:ses_nonce_two",
      sessionId: "ses_nonce_two",
      outcome: "VALID_CLOSE",
      evidence: createSettlementEvidence({
        sessionId: "ses_nonce_two",
        policyHash: "sha256:policy",
        outcome: "VALID_CLOSE",
        usageChargedAtomic: "1000",
        penaltyAtomic: "0",
        bondRefundedAtomic: "1000000",
        nonce: "shared-nonce",
        issuedAt: "2026-08-02T12:00:01.000Z",
        authority: "test",
      }, "test-secret"),
    });
    await expect(claimSettlementEvidenceNonce(repository, second))
      .rejects.toThrow("SETTLEMENT_EVIDENCE_REPLAY");
  });

  it("keeps confirmed attempts terminal under stale updates", async () => {
    const repository = new InMemoryRepository();
    const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
    const attempt = await getOrCreateSettlementAttempt(repository, clock, {
      attemptId: "close:ses_attempt",
      sessionId: "ses_attempt",
      outcome: "VALID_CLOSE",
      evidence: evidence("2026-08-02T12:00:00.000Z", "terminal"),
    });

    clock.advance(1_000);
    await updateSettlementAttempt(repository, clock, attempt, {
      status: "CONFIRMED",
      retryable: false,
      providerReference: "tx:confirmed",
    });
    clock.advance(1_000);
    const persisted = await updateSettlementAttempt(repository, clock, attempt, {
      status: "PENDING",
      retryable: true,
      failureCode: "CONFIRMATION_PENDING",
    });

    expect(persisted).toMatchObject({
      status: "CONFIRMED",
      retryable: false,
      providerReference: "tx:confirmed",
      updatedAt: "2026-08-02T12:00:01.000Z",
    });
    expect(persisted.failureCode).toBeUndefined();
  });

  it("persists pending provider references and terminal status", async () => {
    const repository = new InMemoryRepository();
    const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
    const attempt = await getOrCreateSettlementAttempt(repository, clock, {
      attemptId: "close:ses_attempt",
      sessionId: "ses_attempt",
      outcome: "VALID_CLOSE",
      evidence: evidence("2026-08-02T12:00:00.000Z", "close"),
    });

    const pending = await updateSettlementAttempt(repository, clock, attempt, {
      status: "PENDING",
      retryable: true,
      providerReference: "tx:pending",
      failureCode: "CONFIRMATION_PENDING",
    });
    expect(await repository.getSettlementAttempt(attempt.attemptId)).toMatchObject({
      status: "PENDING",
      retryable: true,
      providerReference: "tx:pending",
      failureCode: "CONFIRMATION_PENDING",
    });

    clock.advance(1_000);
    await updateSettlementAttempt(repository, clock, pending, {
      status: "CONFIRMED",
      retryable: false,
      providerReference: "tx:pending",
    });
    expect(await repository.getSettlementAttempt(attempt.attemptId)).toMatchObject({
      status: "CONFIRMED",
      retryable: false,
      providerReference: "tx:pending",
      updatedAt: "2026-08-02T12:00:01.000Z",
    });
    expect((await repository.getSettlementAttempt(attempt.attemptId))?.failureCode)
      .toBeUndefined();
  });
});
