import { describe, expect, it } from "vitest";
import type { BondAdapter, BondSettlementResult } from "@botbond/contracts";
import { pollSettlement } from "../src/settlement-polling.js";

const pending: BondSettlementResult = {
  status: "PENDING",
  retryable: true,
  providerReference: "tx-1",
  bondRefundedAtomic: "10",
  penaltyAtomic: "0",
};

describe("settlement transaction polling", () => {
  it("polls PENDING provider references until confirmed", async () => {
    let calls = 0;
    const bond = {
      async getTransactionStatus() {
        calls += 1;
        return calls < 2
          ? { status: "PENDING" as const, retryable: true }
          : { status: "CONFIRMED" as const, retryable: false };
      },
    } as unknown as BondAdapter;

    const result = await pollSettlement(bond, pending, {
      attempts: 3,
      intervalMs: 0,
    });

    expect(result.status).toBe("CONFIRMED");
    expect(result.bondRefundedAtomic).toBe("10");
    expect(calls).toBe(2);
  });

  it("keeps a retryable PENDING result after bounded attempts", async () => {
    const bond = {
      async getTransactionStatus() {
        return { status: "PENDING" as const, retryable: true };
      },
    } as unknown as BondAdapter;

    const result = await pollSettlement(bond, pending, {
      attempts: 2,
      intervalMs: 0,
    });

    expect(result).toMatchObject({
      status: "PENDING",
      retryable: true,
      providerReference: "tx-1",
    });
  });

  it("returns terminal failures without more polling", async () => {
    let calls = 0;
    const bond = {
      async getTransactionStatus() {
        calls += 1;
        return { status: "FAILED" as const, retryable: false, failureCode: "TX_FAILED" };
      },
    } as unknown as BondAdapter;

    const result = await pollSettlement(bond, pending, {
      attempts: 5,
      intervalMs: 0,
    });

    expect(result).toMatchObject({ status: "FAILED", retryable: false, failureCode: "TX_FAILED" });
    expect(calls).toBe(1);
  });
});
