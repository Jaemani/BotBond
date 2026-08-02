import type {
  AdapterResult,
  BondAdapter,
  BondSettlementResult,
  BondVerificationResult,
  PaymentAdapter,
  PaymentVerificationResult,
  UsageSettlementResult,
} from "./index.js";

export interface AdapterContractCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface PaymentAdapterContractInput {
  adapter: PaymentAdapter;
  sessionId: string;
  credential: string;
  usageCapAtomic: string;
  calls: number;
}

export interface PaymentAdapterContractReport {
  checks: AdapterContractCheck[];
  verification: PaymentVerificationResult;
  settlement?: UsageSettlementResult;
}

export interface BondAdapterContractInput {
  adapter: BondAdapter;
  sessionId: string;
  bondAccount: string;
  policyHash: string;
  bondAmountAtomic: string;
  maxPenaltyAtomic: string;
  expiryPenaltyAtomic: string;
  reservationId: string;
}

export interface BondAdapterContractReport {
  checks: AdapterContractCheck[];
  verification: BondVerificationResult;
  validClose?: BondSettlementResult;
  expiredSettlement?: BondSettlementResult;
  transactionStatus?: AdapterResult;
}

const check = (name: string, condition: boolean, detail?: string): AdapterContractCheck => ({
  name,
  passed: condition,
  ...(detail ? { detail } : {}),
});

export async function runPaymentAdapterContract(input: PaymentAdapterContractInput): Promise<PaymentAdapterContractReport> {
  const challenge = await input.adapter.createChallenge({ sessionId: input.sessionId, usageCapAtomic: input.usageCapAtomic });
  const verification = await input.adapter.verifyCredential({
    sessionId: input.sessionId,
    credential: input.credential,
    ...(challenge.challenge ? { challenge: challenge.challenge } : {}),
  });
  const checks = [
    check("challenge returns stable status", ["PENDING", "CONFIRMED", "FAILED"].includes(challenge.status)),
    check("verification is confirmed", verification.status === "CONFIRMED", verification.failureCode),
    check(
      "verified payment covers policy cap",
      verification.usageLimitAtomic !== undefined && BigInt(verification.usageLimitAtomic) >= BigInt(input.usageCapAtomic),
    ),
  ];
  if (verification.status !== "CONFIRMED") return { checks, verification };
  const settlement = await input.adapter.getUsageSettlement({
    sessionId: input.sessionId,
    calls: input.calls,
    usageCapAtomic: input.usageCapAtomic,
  });
  checks.push(
    check("usage settlement is confirmed", settlement.status === "CONFIRMED", settlement.failureCode),
    check(
      "usage settlement does not exceed cap",
      settlement.usageChargedAtomic !== undefined && BigInt(settlement.usageChargedAtomic) <= BigInt(input.usageCapAtomic),
    ),
  );
  return { checks, verification, settlement };
}

export async function runBondAdapterContract(input: BondAdapterContractInput): Promise<BondAdapterContractReport> {
  const verification = await input.adapter.verifyOpenBond({
    sessionId: input.sessionId,
    bondAccount: input.bondAccount,
    policyHash: input.policyHash,
    amountAtomic: input.bondAmountAtomic,
    maxPenaltyAtomic: input.maxPenaltyAtomic,
  });
  const checks = [
    check("bond verification is confirmed", verification.status === "CONFIRMED", verification.failureCode),
    check("bond amount matches policy", verification.bondAmountAtomic === input.bondAmountAtomic),
    check("max penalty matches policy", verification.maxPenaltyAtomic === input.maxPenaltyAtomic),
  ];
  if (verification.status !== "CONFIRMED") return { checks, verification };

  const validClose = await input.adapter.requestValidClose({
    sessionId: `${input.sessionId}-valid-close`,
    policyHash: input.policyHash,
    amountAtomic: input.bondAmountAtomic,
  });
  checks.push(
    check("valid close confirms", validClose.status === "CONFIRMED", validClose.failureCode),
    check("valid close has zero penalty", validClose.penaltyAtomic === "0"),
    check("valid close refunds full bond", validClose.bondRefundedAtomic === input.bondAmountAtomic),
  );

  const expiredSettlement = await input.adapter.requestExpiredReservationSettlement({
    sessionId: `${input.sessionId}-expired`,
    policyHash: input.policyHash,
    penaltyAtomic: input.expiryPenaltyAtomic,
    maxPenaltyAtomic: input.maxPenaltyAtomic,
    bondAmountAtomic: input.bondAmountAtomic,
    reservationId: input.reservationId,
  });
  const penalty = BigInt(expiredSettlement.penaltyAtomic ?? input.bondAmountAtomic);
  checks.push(
    check("expired settlement confirms", expiredSettlement.status === "CONFIRMED", expiredSettlement.failureCode),
    check("expired settlement is bounded", penalty <= BigInt(input.maxPenaltyAtomic) && penalty <= BigInt(input.bondAmountAtomic)),
    check(
      "expired settlement conserves bond",
      expiredSettlement.bondRefundedAtomic !== undefined && BigInt(expiredSettlement.bondRefundedAtomic) + penalty === BigInt(input.bondAmountAtomic),
    ),
  );

  const reference = expiredSettlement.providerReference ?? validClose.providerReference;
  if (!reference) return { checks, verification, validClose, expiredSettlement };
  const transactionStatus = await input.adapter.getTransactionStatus({ providerReference: reference });
  checks.push(check("transaction status uses stable envelope", ["PENDING", "CONFIRMED", "FAILED"].includes(transactionStatus.status)));
  return { checks, verification, validClose, expiredSettlement, transactionStatus };
}

export function assertAdapterContract(checks: AdapterContractCheck[]): void {
  const failed = checks.filter((entry) => !entry.passed);
  if (failed.length > 0) {
    throw new Error(`ADAPTER_CONTRACT_FAILED:${failed.map((entry) => `${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`).join("; ")}`);
  }
}
