import type { BondAdapter, BotBondEvent, PaymentAdapter, SettlementReceipt } from "@botbond/contracts";
import type { Clock } from "./clock.js";
import type { DemoCommerceApi } from "./commerce.js";
import type { Repository, ReservationRecord, SessionRecord } from "./repository.js";
import { validateExpiredReservationSettlement, validateUsageSettlement } from "./adapter-validation.js";
import { claimSettlementEvidenceNonce, expiryAttemptId, getOrCreateSettlementAttempt, updateSettlementAttempt } from "./settlement-attempt.js";
import { createSettlementEvidence } from "./settlement-evidence.js";
import { pollSettlement, type SettlementPollingOptions } from "./settlement-polling.js";

const DEFAULT_SETTLEMENT_LEASE_MS = 30_000;

export interface ExpiryProcessorDependencies {
  repository: Repository;
  commerce: DemoCommerceApi;
  payment: PaymentAdapter;
  bond: BondAdapter;
  clock: Clock;
  settlementSigningSecret?: string;
  settlementAuthority?: string;
  settlementPolling?: SettlementPollingOptions;
  emit(event: Omit<BotBondEvent, "eventId" | "occurredAt">): Promise<void>;
}

export interface ExpiryResult {
  reservationId: string;
  status: "SKIPPED" | "EXPIRED" | "RETRYABLE" | "FAILED";
  reason?: string;
  receipt?: SettlementReceipt;
}

export async function processExpiredReservations(dependencies: ExpiryProcessorDependencies): Promise<ExpiryResult[]> {
  const results: ExpiryResult[] = [];
  const sessions = await dependencies.repository.listSessions();
  for (const session of sessions.filter((entry) => (entry.state === "ACTIVE" || entry.state === "SETTLING") && entry.policy.bondedActions.length > 0)) {
    const reservations = await dependencies.repository.listReservations(session.sessionId);
    for (const reservation of reservations.filter((entry) => entry.state === "ACTIVE" && new Date(entry.expiresAt).getTime() <= dependencies.clock.now().getTime())) {
      results.push(await expireOne(dependencies, session, reservation));
    }
  }
  return results;
}

async function expireOne(dependencies: ExpiryProcessorDependencies, session: SessionRecord, reservation: ReservationRecord): Promise<ExpiryResult> {
  const action = session.policy.bondedActions.find((entry) => entry.operationId === "reserve-inventory") ?? session.policy.bondedActions[0];
  if (!action) return { reservationId: reservation.reservationId, status: "SKIPPED", reason: "BONDED_ACTION_MISSING" };
  const locked = await dependencies.repository.claimSettlement(
    session.sessionId,
    dependencies.clock.now(),
    DEFAULT_SETTLEMENT_LEASE_MS,
  );
  if (!locked) {
    return { reservationId: reservation.reservationId, status: "RETRYABLE", reason: "SESSION_SETTLEMENT_IN_PROGRESS" };
  }
  const unlock = async (): Promise<void> => {
    await dependencies.repository.transitionSession(session.sessionId, "SETTLING", "ACTIVE").catch(() => undefined);
  };

  const usage = await dependencies.payment.getUsageSettlement({
    sessionId: session.sessionId,
    calls: session.calls,
    usageCapAtomic: session.policy.constraints.usageCapAtomic,
  });
  if (usage.status !== "CONFIRMED") {
    await unlock();
    return { reservationId: reservation.reservationId, status: usage.retryable ? "RETRYABLE" : "FAILED", reason: usage.failureCode ?? "USAGE_SETTLEMENT_NOT_CONFIRMED" };
  }
  let usageChargedAtomic: string;
  try {
    usageChargedAtomic = validateUsageSettlement(usage, session.policy.constraints.usageCapAtomic);
  } catch {
    await unlock();
    return { reservationId: reservation.reservationId, status: "FAILED", reason: "INVALID_USAGE_SETTLEMENT" };
  }
  const penaltyAtomic = action.expiryPenaltyAtomic;
  const bondRefundedAtomic = (BigInt(session.policy.constraints.bondAmountAtomic) - BigInt(penaltyAtomic)).toString();
  const evidenceSecret = dependencies.settlementSigningSecret ?? process.env.BOTBOND_EVIDENCE_SECRET ?? "fake-local-settlement-secret";
  const createdEvidence = createSettlementEvidence({ sessionId: session.sessionId, policyHash: session.policyHash, reservationId: reservation.reservationId, outcome: "EXPIRED_RESERVATION", usageChargedAtomic, penaltyAtomic, bondRefundedAtomic, nonce: `expiry:${reservation.reservationId}`, issuedAt: dependencies.clock.now().toISOString(), authority: dependencies.settlementAuthority ?? "botbond-expiry-worker-local" }, evidenceSecret);
  let attempt = await getOrCreateSettlementAttempt(dependencies.repository, dependencies.clock, {
    attemptId: expiryAttemptId(session.sessionId, reservation.reservationId),
    sessionId: session.sessionId,
    outcome: "EXPIRED_RESERVATION",
    reservationId: reservation.reservationId,
    evidence: createdEvidence,
  });
  await claimSettlementEvidenceNonce(dependencies.repository, attempt);
  let settlement = await dependencies.bond.requestExpiredReservationSettlement({
    sessionId: session.sessionId,
    ...(session.bondReference ? { bondAccount: session.bondReference } : {}),
    policyHash: session.policyHash,
    penaltyAtomic,
    maxPenaltyAtomic: session.policy.constraints.maxPenaltyAtomic,
    bondAmountAtomic: session.policy.constraints.bondAmountAtomic,
    reservationId: reservation.reservationId,
    evidence: attempt.evidence,
  });
  attempt = await updateSettlementAttempt(dependencies.repository, dependencies.clock, attempt, settlement);
  settlement = await pollSettlement(dependencies.bond, settlement, dependencies.settlementPolling);
  await updateSettlementAttempt(dependencies.repository, dependencies.clock, attempt, settlement);
  if (settlement.status !== "CONFIRMED") {
    await unlock();
    return { reservationId: reservation.reservationId, status: settlement.retryable ? "RETRYABLE" : "FAILED", reason: settlement.failureCode ?? "EXPIRY_SETTLEMENT_NOT_CONFIRMED" };
  }
  let settledAmounts: { bondRefundedAtomic: string; penaltyAtomic: string };
  try {
    settledAmounts = validateExpiredReservationSettlement(settlement, {
      penaltyAtomic,
      maxPenaltyAtomic: session.policy.constraints.maxPenaltyAtomic,
      bondAmountAtomic: session.policy.constraints.bondAmountAtomic,
    });
  } catch {
    await unlock();
    return { reservationId: reservation.reservationId, status: "FAILED", reason: "INVALID_BOND_SETTLEMENT" };
  }

  const finalized = await dependencies.commerce.finalizeReservation(session.sessionId, reservation.reservationId, "EXPIRED");
  if (!finalized.changed) {
    await unlock();
    return { reservationId: reservation.reservationId, status: "SKIPPED", reason: "ALREADY_FINALIZED" };
  }
  finalized.reservation.settlementRequested = true;
  await dependencies.repository.saveReservation(finalized.reservation);

  const traceId = session.traceId;
  const events: Array<Omit<BotBondEvent, "eventId" | "occurredAt">> = [
    { sessionId: session.sessionId, type: "RESERVATION_EXPIRED", traceId, data: { reservationId: reservation.reservationId } },
    { sessionId: session.sessionId, type: "PENALTY_SETTLED", traceId, data: { status: settlement.status, penaltyAtomic: settledAmounts.penaltyAtomic, bondRefundedAtomic: settledAmounts.bondRefundedAtomic, ...(settlement.providerReference ? { providerReference: settlement.providerReference } : {}), ...(settlement.fixtureMarker ? { fixtureMarker: settlement.fixtureMarker } : {}) } },
    { sessionId: session.sessionId, type: "USAGE_SETTLED", traceId, data: { calls: session.calls, usageChargedAtomic, ...(usage.fixtureMarker ? { fixtureMarker: usage.fixtureMarker } : {}) } },
  ];
  for (const event of events) await dependencies.emit(event);

  const receiptBody = {
    sessionId: session.sessionId,
    outcome: "EXPIRED" as const,
    policyHash: session.policyHash,
    calls: session.calls,
    usageChargedAtomic,
    bondRefundedAtomic: settledAmounts.bondRefundedAtomic,
    penaltyAtomic: settledAmounts.penaltyAtomic,
    transactions: [
      { kind: "PAYMENT" as const, status: usage.status, ...(usage.providerReference ? { providerReference: usage.providerReference } : {}), ...(usage.fixtureMarker ? { fixtureMarker: usage.fixtureMarker } : {}) },
      { kind: "BOND" as const, status: settlement.status, ...(settlement.providerReference ? { providerReference: settlement.providerReference } : {}), ...(settlement.fixtureMarker ? { fixtureMarker: settlement.fixtureMarker } : {}) },
    ],
  };
  const { sha256Hash } = await import("@botbond/contracts");
  const receipt: SettlementReceipt = { ...receiptBody, receiptHash: sha256Hash(receiptBody) };
  const expiredSession = await dependencies.repository.transitionSession(session.sessionId, "SETTLING", "EXPIRED");
  expiredSession.receipt = receipt;
  await dependencies.repository.saveSession(expiredSession);
  return { reservationId: reservation.reservationId, status: "EXPIRED", receipt };
}
