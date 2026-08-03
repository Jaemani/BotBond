import type { AdapterResult, BondAdapter, BondSettlementResult } from "@botbond/contracts";

export interface SettlementPollingOptions {
  attempts?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function pollSettlement(
  bond: BondAdapter,
  settlement: BondSettlementResult,
  options: SettlementPollingOptions = {},
): Promise<BondSettlementResult> {
  if (settlement.status !== "PENDING" || !settlement.providerReference) return settlement;

  const attempts = options.attempts ?? 5;
  const intervalMs = options.intervalMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  let status: AdapterResult = settlement;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && intervalMs > 0) await sleep(intervalMs);
    status = await bond.getTransactionStatus({ providerReference: settlement.providerReference });
    if (status.status === "CONFIRMED") {
      return { ...settlement, status: "CONFIRMED", retryable: false };
    }
    if (status.status === "FAILED") {
      return {
        ...settlement,
        status: "FAILED",
        retryable: status.retryable,
        ...(status.failureCode ? { failureCode: status.failureCode } : {}),
      };
    }
  }

  return {
    ...settlement,
    status: "PENDING",
    retryable: true,
    ...(status.failureCode ? { failureCode: status.failureCode } : {}),
  };
}
