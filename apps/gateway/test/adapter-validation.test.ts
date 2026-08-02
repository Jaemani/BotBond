import { describe, expect, it } from "vitest";
import type { BondSettlementResult, UsageSettlementResult } from "@botbond/contracts";
import { validateExpiredReservationSettlement, validateUsageSettlement, validateValidCloseSettlement } from "../src/adapter-validation.js";

const confirmed = (values: Partial<BondSettlementResult> = {}): BondSettlementResult => ({ status: "CONFIRMED", retryable: false, ...values });

describe("adapter result validation", () => {
  it("rejects malformed or over-cap usage", () => {
    expect(() => validateUsageSettlement({ status: "CONFIRMED", retryable: false, usageChargedAtomic: "x" } as UsageSettlementResult, "10")).toThrow("INVALID_USAGE_SETTLEMENT");
    expect(() => validateUsageSettlement({ status: "CONFIRMED", retryable: false, usageChargedAtomic: "11" }, "10")).toThrow("INVALID_USAGE_SETTLEMENT");
  });

  it("requires zero penalty and full valid-close refund", () => {
    expect(validateValidCloseSettlement(confirmed({ bondRefundedAtomic: "100", penaltyAtomic: "0" }), "100")).toEqual({ bondRefundedAtomic: "100", penaltyAtomic: "0" });
    expect(() => validateValidCloseSettlement(confirmed({ bondRefundedAtomic: "99", penaltyAtomic: "1" }), "100")).toThrow("INVALID_BOND_SETTLEMENT");
  });

  it("requires exact bounded expiry penalty and bond conservation", () => {
    const input = { penaltyAtomic: "20", maxPenaltyAtomic: "20", bondAmountAtomic: "100" };
    expect(validateExpiredReservationSettlement(confirmed({ bondRefundedAtomic: "80", penaltyAtomic: "20" }), input)).toEqual({ bondRefundedAtomic: "80", penaltyAtomic: "20" });
    expect(() => validateExpiredReservationSettlement(confirmed({ bondRefundedAtomic: "79", penaltyAtomic: "20" }), input)).toThrow("INVALID_BOND_SETTLEMENT");
    expect(() => validateExpiredReservationSettlement(confirmed({ bondRefundedAtomic: "80", penaltyAtomic: "21" }), input)).toThrow("INVALID_BOND_SETTLEMENT");
  });
});
