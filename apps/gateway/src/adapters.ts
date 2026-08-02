import type {
  AdapterResult,
  BondAdapter,
  BondSettlementResult,
  BondVerificationResult,
  PaymentAdapter,
  PaymentChallengeResult,
  PaymentVerificationResult,
  UsageSettlementResult,
} from "@botbond/contracts";

const MARKER = "FAKE_ADAPTER_FIXTURE" as const;

export class FakePaymentAdapter implements PaymentAdapter {
  constructor(private readonly options: { failCredential?: boolean; usagePerCallAtomic?: bigint } = {}) {}

  async createChallenge(input: { sessionId: string; usageCapAtomic: string }): Promise<PaymentChallengeResult> {
    return { status: "CONFIRMED", retryable: false, challenge: `fake-challenge:${input.sessionId}`, fixtureMarker: MARKER };
  }

  async verifyCredential(input: { sessionId: string; credential: string }): Promise<PaymentVerificationResult> {
    if (this.options.failCredential || input.credential !== "fake-payment-ok") {
      return { status: "FAILED", retryable: false, failureCode: "PAYMENT_CREDENTIAL_INVALID", fixtureMarker: MARKER };
    }
    return {
      status: "CONFIRMED",
      retryable: false,
      usageLimitAtomic: "200000",
      providerReference: `fake-payment:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async getUsageSettlement(input: { sessionId: string; calls: number; usageCapAtomic: string }): Promise<UsageSettlementResult> {
    const perCall = this.options.usagePerCallAtomic ?? 1000n;
    const charged = perCall * BigInt(input.calls);
    const capped = charged > BigInt(input.usageCapAtomic) ? BigInt(input.usageCapAtomic) : charged;
    return {
      status: "CONFIRMED",
      retryable: false,
      usageChargedAtomic: capped.toString(),
      providerReference: `fake-usage:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }
}

export class FakeBondAdapter implements BondAdapter {
  public readonly validCloseRequests: string[] = [];
  public readonly expirySettlementRequests: Array<{ sessionId: string; penaltyAtomic: string }> = [];

  constructor(private readonly options: { failVerification?: boolean } = {}) {}

  async verifyOpenBond(input: { sessionId: string; bondAccount: string; policyHash: string; amountAtomic: string; maxPenaltyAtomic: string }): Promise<BondVerificationResult> {
    if (this.options.failVerification || input.bondAccount !== "fake-bond-ok") {
      return { status: "FAILED", retryable: false, failureCode: "BOND_NOT_CONFIRMED", fixtureMarker: MARKER };
    }
    return {
      status: "CONFIRMED",
      retryable: false,
      bondAmountAtomic: input.amountAtomic,
      maxPenaltyAtomic: input.maxPenaltyAtomic,
      providerReference: `fake-bond:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async requestValidClose(input: { sessionId: string; amountAtomic: string }): Promise<BondSettlementResult> {
    if (!this.validCloseRequests.includes(input.sessionId)) this.validCloseRequests.push(input.sessionId);
    return {
      status: "CONFIRMED",
      retryable: false,
      bondRefundedAtomic: input.amountAtomic,
      penaltyAtomic: "0",
      providerReference: `fake-bond-refund:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async requestExpiredReservationSettlement(input: { sessionId: string; penaltyAtomic: string; maxPenaltyAtomic: string; bondAmountAtomic: string }): Promise<BondSettlementResult> {
    const penalty = BigInt(input.penaltyAtomic);
    const bounded = [penalty, BigInt(input.maxPenaltyAtomic), BigInt(input.bondAmountAtomic)].reduce((minimum, value) => value < minimum ? value : minimum);
    if (!this.expirySettlementRequests.some((request) => request.sessionId === input.sessionId)) {
      this.expirySettlementRequests.push({ sessionId: input.sessionId, penaltyAtomic: bounded.toString() });
    }
    return {
      status: "CONFIRMED",
      retryable: false,
      bondRefundedAtomic: (BigInt(input.bondAmountAtomic) - bounded).toString(),
      penaltyAtomic: bounded.toString(),
      providerReference: `fake-bond-expiry:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async getTransactionStatus(input: { providerReference: string }): Promise<AdapterResult> {
    return { status: "CONFIRMED", retryable: false, providerReference: input.providerReference, fixtureMarker: MARKER };
  }
}

export function adaptersFromEnvironment(): { payment: PaymentAdapter; bond: BondAdapter } {
  const mode = process.env.ADAPTER_MODE ?? "fake";
  if (mode !== "fake") throw new Error("REAL_ADAPTER_MODE_NOT_IMPLEMENTED");
  return { payment: new FakePaymentAdapter(), bond: new FakeBondAdapter() };
}
