import { describe, expect, it } from "vitest";
import { assertAdapterContract, runBondAdapterContract, runPaymentAdapterContract } from "../src/adapter-contract.js";
import type { BondAdapter, PaymentAdapter } from "../src/index.js";

const fakePayment: PaymentAdapter = {
  async createChallenge({ sessionId }) {
    return { status: "CONFIRMED", retryable: false, challenge: `challenge:${sessionId}`, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
  async verifyCredential({ sessionId }) {
    return { status: "CONFIRMED", retryable: false, usageLimitAtomic: "200000", providerReference: `payment:${sessionId}`, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
  async getUsageSettlement({ sessionId, calls }) {
    return { status: "CONFIRMED", retryable: false, usageChargedAtomic: String(calls * 1000), providerReference: `usage:${sessionId}`, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
};

const fakeBond: BondAdapter = {
  async verifyOpenBond({ sessionId, amountAtomic, maxPenaltyAtomic }) {
    return { status: "CONFIRMED", retryable: false, bondAmountAtomic: amountAtomic, maxPenaltyAtomic, providerReference: `bond:${sessionId}`, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
  async requestValidClose({ sessionId, amountAtomic }) {
    return { status: "CONFIRMED", retryable: false, bondRefundedAtomic: amountAtomic, penaltyAtomic: "0", providerReference: `refund:${sessionId}`, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
  async requestExpiredReservationSettlement({ sessionId, penaltyAtomic, maxPenaltyAtomic, bondAmountAtomic }) {
    const penalty = [BigInt(penaltyAtomic), BigInt(maxPenaltyAtomic), BigInt(bondAmountAtomic)].reduce((a, b) => a < b ? a : b);
    return { status: "CONFIRMED", retryable: false, penaltyAtomic: penalty.toString(), bondRefundedAtomic: (BigInt(bondAmountAtomic) - penalty).toString(), providerReference: `expired:${sessionId}`, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
  async getTransactionStatus({ providerReference }) {
    return { status: "CONFIRMED", retryable: false, providerReference, fixtureMarker: "FAKE_ADAPTER_FIXTURE" };
  },
};

describe("Role C adapter contract harness", () => {
  it("accepts a conforming payment adapter", async () => {
    const report = await runPaymentAdapterContract({ adapter: fakePayment, sessionId: "ses_contract", credential: "opaque", usageCapAtomic: "200000", calls: 3 });
    expect(() => assertAdapterContract(report.checks)).not.toThrow();
  });

  it("accepts a conforming bond adapter", async () => {
    const report = await runBondAdapterContract({ adapter: fakeBond, sessionId: "ses_contract", bondAccount: "bond-account", policyHash: "sha256:fixture", bondAmountAtomic: "1000000", maxPenaltyAtomic: "200000", expiryPenaltyAtomic: "200000", reservationId: "res_contract" });
    expect(() => assertAdapterContract(report.checks)).not.toThrow();
  });

  it("rejects insufficient payment caps", async () => {
    const insufficient: PaymentAdapter = { ...fakePayment, async verifyCredential() { return { status: "CONFIRMED", retryable: false, usageLimitAtomic: "1" }; } };
    const report = await runPaymentAdapterContract({ adapter: insufficient, sessionId: "ses_contract", credential: "opaque", usageCapAtomic: "200000", calls: 1 });
    expect(() => assertAdapterContract(report.checks)).toThrow("verified payment covers policy cap");
  });
});
