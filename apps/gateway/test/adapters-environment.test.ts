import { afterEach, describe, expect, it } from "vitest";
import { CappedSessionPaymentAdapter } from "@botbond/payment-client";
import { adaptersFromEnvironment, FakeBondAdapter, FakePaymentAdapter, FixtureMarkedPaymentAdapter } from "../src/adapters.js";

const managed = [
  "ADAPTER_MODE",
  "ANCHOR_PROVIDER_URL",
  "ANCHOR_WALLET",
  "BOTBOND_EVIDENCE_SECRET",
  "BOTBOND_PAYMENT_SECRET",
] as const;
const original = Object.fromEntries(managed.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of managed) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("adapter environment factory", () => {
  it("defaults to visibly fake adapters", () => {
    delete process.env.ADAPTER_MODE;
    const adapters = adaptersFromEnvironment();
    expect(adapters.payment).toBeInstanceOf(FakePaymentAdapter);
    expect(adapters.bond).toBeInstanceOf(FakeBondAdapter);
  });

  it("fails closed when Solana mode secrets are absent", () => {
    process.env.ADAPTER_MODE = "solana";
    process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
    process.env.ANCHOR_WALLET = "/tmp/nonexistent-wallet.json";
    delete process.env.BOTBOND_EVIDENCE_SECRET;
    delete process.env.BOTBOND_PAYMENT_SECRET;
    expect(() => adaptersFromEnvironment()).toThrow("BOTBOND_EVIDENCE_SECRET_REQUIRED");
  });

  it("uses unit price 1000 and visibly marks the local credential bridge", async () => {
    const payment = new FixtureMarkedPaymentAdapter(
      new CappedSessionPaymentAdapter({ hmacSecret: "test-only-payment-secret" }),
    );
    const result = await payment.getUsageSettlement({
      sessionId: "ses_test",
      calls: 3,
      usageCapAtomic: "200000",
    });
    expect(result.usageChargedAtomic).toBe("3000");
    expect(result.fixtureMarker).toBe("FAKE_ADAPTER_FIXTURE");
  });
});
