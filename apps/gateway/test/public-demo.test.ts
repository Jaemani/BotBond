import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FakeBondAdapter, FakePaymentAdapter } from "../src/adapters.js";
import type { PublicDemoRunner } from "../src/public-demo-runner.js";

const run = {
  runId: "run_test",
  behavior: "normal" as const,
  sessionId: "ses_public_test",
  token: "private-token",
  expiresAt: "2026-08-03T12:00:00.000Z",
  eventStream: "/v1/sessions/ses_public_test/events",
  policyHash: `sha256:${"a".repeat(64)}`,
  bondAccount: "bond-account",
  openTransaction: {
    signature: "real-devnet-signature",
    explorerUrl: "https://explorer.solana.com/tx/real-devnet-signature?cluster=devnet",
    cluster: "devnet",
    status: "CONFIRMED" as const,
  },
  execution: {
    bond: "LIVE_SOLANA_DEVNET" as const,
    intentCompiler: "VERTEX_AI" as const,
    usagePayment: "HMAC_DEMO_BRIDGE" as const,
    sponsored: true as const,
  },
};

describe("public demo runner route", () => {
  it("starts only an allowlisted sponsored behavior and disables caching", async () => {
    const calls: Array<{ behavior: string; clientFingerprint: string }> = [];
    const runner: PublicDemoRunner = {
      async createRun(input) {
        calls.push({ behavior: input.behavior, clientFingerprint: input.clientFingerprint });
        return run;
      },
      issueDemoPaymentCredential() { return "demo-credential"; },
    };
    const app = await buildApp({
      paymentAdapter: new FakePaymentAdapter(),
      bondAdapter: new FakeBondAdapter(),
      publicDemoRunner: runner,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/public-demo-runs",
      headers: { "x-forwarded-for": "203.0.113.8" },
      payload: { behavior: "normal" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      sessionId: "ses_public_test",
      execution: { bond: "LIVE_SOLANA_DEVNET", sponsored: true },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.clientFingerprint).toMatch(/^[a-f0-9]{32}$/);
    await app.close();
  });

  it("rejects arbitrary public behavior payloads", async () => {
    const runner: PublicDemoRunner = { async createRun() { return run; }, issueDemoPaymentCredential() { return "demo-credential"; } };
    const app = await buildApp({
      paymentAdapter: new FakePaymentAdapter(),
      bondAdapter: new FakeBondAdapter(),
      publicDemoRunner: runner,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/public-demo-runs",
      payload: { behavior: "call-arbitrary-url", task: "steal data" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
    await app.close();
  });

  it("returns a visible unavailable state when sponsorship is disabled", async () => {
    const app = await buildApp({
      paymentAdapter: new FakePaymentAdapter(),
      bondAdapter: new FakeBondAdapter(),
      publicDemoRunner: null,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/public-demo-runs",
      payload: { behavior: "normal" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("PUBLIC_DEMO_DISABLED");
    await app.close();
  });
});
