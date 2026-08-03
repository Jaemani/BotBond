import type { AdapterResult, SettlementAuthorizationEvidence } from "@botbond/contracts";
import type { Clock } from "./clock.js";
import type { Repository, SettlementAttemptRecord } from "./repository.js";

export function closeAttemptId(sessionId: string): string {
  return `close:${sessionId}`;
}

export function expiryAttemptId(sessionId: string, reservationId: string): string {
  return `expiry:${sessionId}:${reservationId}`;
}

export async function getOrCreateSettlementAttempt(
  repository: Repository,
  clock: Clock,
  input: {
    attemptId: string;
    sessionId: string;
    outcome: SettlementAttemptRecord["outcome"];
    reservationId?: string;
    evidence: SettlementAuthorizationEvidence;
  },
): Promise<SettlementAttemptRecord> {
  const now = clock.now().toISOString();
  const attempt: SettlementAttemptRecord = {
    attemptId: input.attemptId,
    sessionId: input.sessionId,
    outcome: input.outcome,
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    evidence: input.evidence,
    status: "PENDING",
    retryable: true,
    startedAt: now,
    updatedAt: now,
  };
  return await repository.createSettlementAttempt(attempt);
}

export async function claimSettlementEvidenceNonce(
  repository: Repository,
  attempt: SettlementAttemptRecord,
): Promise<void> {
  const claimed = await repository.claimSettlementNonce(
    attempt.evidence.nonce,
    attempt.evidence.evidenceHash,
  );
  if (!claimed) throw new Error("SETTLEMENT_EVIDENCE_REPLAY");
}

export async function updateSettlementAttempt(
  repository: Repository,
  clock: Clock,
  attempt: SettlementAttemptRecord,
  result: AdapterResult,
): Promise<SettlementAttemptRecord> {
  const { failureCode: _failureCode, ...current } = attempt;
  const updated: SettlementAttemptRecord = {
    ...current,
    status: result.status,
    retryable: result.retryable,
    ...(result.providerReference ? { providerReference: result.providerReference } : {}),
    ...(result.failureCode ? { failureCode: result.failureCode } : {}),
    updatedAt: clock.now().toISOString(),
  };
  return await repository.saveSettlementAttempt(updated);
}
