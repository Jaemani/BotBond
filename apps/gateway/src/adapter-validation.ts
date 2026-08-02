import type { BondSettlementResult, UsageSettlementResult } from "@botbond/contracts";

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function requireAtomic(value: string | undefined, code: string): bigint {
  if (value === undefined || !DECIMAL.test(value)) throw new Error(code);
  return BigInt(value);
}

export function validateUsageSettlement(result: UsageSettlementResult, usageCapAtomic: string): string {
  const charged = requireAtomic(result.usageChargedAtomic, "INVALID_USAGE_SETTLEMENT");
  if (charged > BigInt(usageCapAtomic)) throw new Error("INVALID_USAGE_SETTLEMENT");
  return charged.toString();
}

export function validateValidCloseSettlement(result: BondSettlementResult, bondAmountAtomic: string): { bondRefundedAtomic: string; penaltyAtomic: string } {
  const refunded = requireAtomic(result.bondRefundedAtomic, "INVALID_BOND_SETTLEMENT");
  const penalty = requireAtomic(result.penaltyAtomic, "INVALID_BOND_SETTLEMENT");
  if (penalty !== 0n || refunded !== BigInt(bondAmountAtomic)) throw new Error("INVALID_BOND_SETTLEMENT");
  return { bondRefundedAtomic: refunded.toString(), penaltyAtomic: penalty.toString() };
}

export function validateExpiredReservationSettlement(
  result: BondSettlementResult,
  input: { penaltyAtomic: string; maxPenaltyAtomic: string; bondAmountAtomic: string },
): { bondRefundedAtomic: string; penaltyAtomic: string } {
  const refunded = requireAtomic(result.bondRefundedAtomic, "INVALID_BOND_SETTLEMENT");
  const penalty = requireAtomic(result.penaltyAtomic, "INVALID_BOND_SETTLEMENT");
  const requested = BigInt(input.penaltyAtomic);
  const maximum = BigInt(input.maxPenaltyAtomic);
  const bond = BigInt(input.bondAmountAtomic);
  if (penalty !== requested || penalty > maximum || penalty > bond || refunded + penalty !== bond) {
    throw new Error("INVALID_BOND_SETTLEMENT");
  }
  return { bondRefundedAtomic: refunded.toString(), penaltyAtomic: penalty.toString() };
}
