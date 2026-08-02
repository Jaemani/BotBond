import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AccessPolicy, type BondAdapter, type MerchantCapabilityCatalog, type PaymentAdapter, validateEvent } from "@botbond/contracts";
import { redact } from "@botbond/observability";
import { FakeBondAdapter, FakePaymentAdapter } from "../src/adapters.js";
import { buildApp } from "../src/app.js";
import { ManualClock } from "../src/clock.js";
import { FakeIntentCompiler } from "../src/compiler.js";
import { InMemoryRepository } from "../src/repository.js";

const catalog = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/merchant-catalog.json", import.meta.url), "utf8")) as MerchantCapabilityCatalog;
const goldenPolicy = JSON.parse(readFileSync(new URL("../../../packages/contracts/fixtures/golden-policy.json", import.meta.url), "utf8")) as AccessPolicy;
const intentBody = (task: string) => ({ task, agentWallet: "DemoAgentWallet1111111111111111111111111111", budget: { usageCapAtomic: "999999", bondCapAtomic: "9999999" } });

async function setup(options: { payment?: PaymentAdapter; bond?: BondAdapter; tokenTtlMs?: number } = {}) {
  const clock = new ManualClock(new Date("2026-08-02T12:00:00.000Z"));
  const repository = new InMemoryRepository();
  const payment = options.payment ?? new FakePaymentAdapter();
  const bond = options.bond ?? new FakeBondAdapter();
  const app = await buildApp({ repository, clock, paymentAdapter: payment, bondAdapter: bond, intentCompiler: new FakeIntentCompiler(clock), catalog, ...(options.tokenTtlMs === undefined ? {} : { tokenTtlMs: options.tokenTtlMs }) });
  return { app, repository, clock, payment, bond };
}

async function createIntent(app: Awaited<ReturnType<typeof buildApp>>, task: string) {
  const response = await app.inject({ method: "POST", url: "/v1/intents", payload: intentBody(task) });
  expect(response.statusCode).toBe(200);
  return response.json() as { intentId: string; policy: AccessPolicy; policyHash: string };
}
async function createSession(app: Awaited<ReturnType<typeof buildApp>>, intent: { intentId: string; policyHash: string }, extra: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: "/v1/sessions", headers: { "idempotency-key": `key-${intent.intentId}` }, payload: { intentId: intent.intentId, policyHash: intent.policyHash, paymentCredential: "fake-payment-ok", ...extra } });
}

describe("Gateway vertical slice", () => {
  it("clamps merchant maxima and excludes seller contacts", async () => {
    const { app } = await setup();
    const response = await app.inject({ method: "POST", url: "/v1/intents", payload: intentBody("Compare 999 laptops and collect seller contact information") });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.policy.allowedOperations.some((operation: { pathTemplate: string }) => operation.pathTemplate === "/seller-contacts")).toBe(false);
    expect(body.excludedPermissions).toEqual(["/seller-contacts"]);
    expect(body.policy.constraints.usageCapAtomic).toBe("200000");
    expect(body.validationMetadata.compilerMode).toBe("FAKE");
    expect(body.validationMetadata.fixtureMarker).toBe("FAKE_COMPILER_FIXTURE");
    await app.close();
  });

  it("payment failure prevents ACTIVE", async () => {
    const { app, repository } = await setup({ payment: new FakePaymentAdapter({ failCredential: true }) });
    const intent = await createIntent(app, "Compare laptop prices and stock only");
    const response = await createSession(app, intent);
    expect(response.statusCode).toBe(402);
    const failedSession = (await repository.listSessions())[0];
    expect(failedSession?.state).not.toBe("ACTIVE");
    await app.close();
  });

  it("releases a failed session-creation idempotency claim for retry", async () => {
    const { app } = await setup({ payment: new FakePaymentAdapter({ failCredential: true }) });
    const intent = await createIntent(app, "Compare laptop prices and stock only");
    const first = await createSession(app, intent);
    const second = await createSession(app, intent);
    expect(first.statusCode).toBe(402);
    expect(second.statusCode).toBe(402);
    expect(second.json().error.code).toBe("PAYMENT_CREDENTIAL_INVALID");
    await app.close();
  });

  it("activates read-only session without bond", async () => {
    const { app, repository } = await setup();
    const intent = await createIntent(app, "Compare laptop prices and stock only");
    expect(intent.policy.bondedActions).toEqual([]);
    const response = await createSession(app, intent);
    expect(response.statusCode).toBe(200);
    expect((await repository.getSession(response.json().sessionId))?.state).toBe("ACTIVE");
    await app.close();
  });

  it("requires confirmed bond for bonded policy", async () => {
    const { app } = await setup();
    const intent = await createIntent(app, "Compare 20 laptops and reserve the best one for 60 seconds");
    const missing = await createSession(app, intent);
    expect(missing.statusCode).toBe(402);
    expect(missing.json().error.code).toBe("BOND_REQUIRED");
    await app.close();
  });

  it("blocks forbidden path before commerce handler and emits zero-penalty denial", async () => {
    const { app, repository } = await setup();
    const intent = await createIntent(app, "Compare laptop prices and stock only");
    const sessionResponse = await createSession(app, intent);
    const session = sessionResponse.json();
    const response = await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/seller-contacts`, headers: { authorization: `Bearer ${session.token}` } });
    expect(response.statusCode).toBe(403);
    const events = await repository.listEvents(session.sessionId);
    expect(events.find((event) => event.type === "REQUEST_DENIED")?.data.penaltyAtomic).toBe("0");
    expect(events.some((event) => event.type === "PENALTY_SETTLED")).toBe(false);
    const decorated = app as unknown as { botbond: { commerce: { sellerContactHandlerCalls: number } } };
    expect(decorated.botbond.commerce.sellerContactHandlerCalls).toBe(0);
    await app.close();
  });

  it("releases reservation, restores inventory, refunds bond, and closes idempotently", async () => {
    const bond = new FakeBondAdapter();
    const { app } = await setup({ bond });
    const intent = await createIntent(app, "Compare 20 laptops and reserve the best one for 60 seconds");
    const sessionResponse = await createSession(app, intent, { bondAccount: "fake-bond-ok" });
    const session = sessionResponse.json();
    const headers = { authorization: `Bearer ${session.token}` };
    const before = (await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/products/lap-1/inventory`, headers })).json().stock;
    const reservationResponse = await app.inject({ method: "POST", url: `/v1/access/${session.sessionId}/reservations`, headers, payload: { productId: "lap-1", quantity: 1 } });
    expect(reservationResponse.statusCode).toBe(200);
    const reservation = reservationResponse.json();
    const release = await app.inject({ method: "POST", url: `/v1/access/${session.sessionId}/reservations/${reservation.reservationId}/release`, headers });
    expect(release.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/products/lap-1/inventory`, headers })).json().stock;
    expect(after).toBe(before);
    const closeHeaders = { authorization: `Bearer ${session.token}`, "idempotency-key": "close-1" };
    const first = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/close`, headers: closeHeaders });
    const second = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/close`, headers: closeHeaders });
    const conflict = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/close`, headers: { authorization: `Bearer ${session.token}`, "idempotency-key": "different-close-key" } });
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(first.json().bondRefundedAtomic).toBe(intent.policy.constraints.bondAmountAtomic);
    expect(bond.validCloseRequests).toEqual([session.sessionId]);
    await app.close();
  });

  it("rejects malformed confirmed close settlement before closing", async () => {
    const baseBond = new FakeBondAdapter();
    const malformedBond: BondAdapter = {
      verifyOpenBond: (input) => baseBond.verifyOpenBond(input),
      requestExpiredReservationSettlement: (input) => baseBond.requestExpiredReservationSettlement(input),
      getTransactionStatus: (input) => baseBond.getTransactionStatus(input),
      async requestValidClose() {
        return { status: "CONFIRMED", retryable: false, bondRefundedAtomic: "999999", penaltyAtomic: "1" };
      },
    };
    const { app, repository } = await setup({ bond: malformedBond });
    const intent = await createIntent(app, "Compare and reserve one laptop for 60 seconds");
    const sessionResponse = await createSession(app, intent, { bondAccount: "fake-bond-ok" });
    expect(sessionResponse.statusCode).toBe(200);
    const session = sessionResponse.json();
    const close = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/close`, headers: { authorization: `Bearer ${session.token}`, "idempotency-key": "bad-close-settlement" } });
    expect(close.statusCode).toBe(502);
    expect((await repository.getSession(session.sessionId))?.state).toBe("ACTIVE");
    await app.close();
  });

  it("expires reservation once, restores inventory, and creates bounded settlement", async () => {
    const bond = new FakeBondAdapter();
    const { app, clock, repository } = await setup({ bond });
    const intent = await createIntent(app, "Compare 20 laptops and reserve the best one for 60 seconds");
    const session = (await createSession(app, intent, { bondAccount: "fake-bond-ok" })).json();
    const headers = { authorization: `Bearer ${session.token}` };
    const before = (await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/products/lap-1/inventory`, headers })).json().stock;
    const reservation = (await app.inject({ method: "POST", url: `/v1/access/${session.sessionId}/reservations`, headers, payload: { productId: "lap-1", quantity: 1 } })).json();
    clock.advance(60_001);
    const url = `/v1/access/${session.sessionId}/reservations/${reservation.reservationId}/expire`;
    expect((await app.inject({ method: "POST", url, headers })).statusCode).toBe(200);
    const afterFirst = await repository.getSession(session.sessionId);
    expect((await app.inject({ method: "POST", url, headers })).statusCode).toBe(200);
    const afterSecond = await repository.getSession(session.sessionId);
    expect(afterSecond?.calls).toBe(afterFirst?.calls);
    expect(afterSecond?.operationCalls).toEqual(afterFirst?.operationCalls);
    const afterRecord = await (app as unknown as { botbond: { commerce: { getInventory(productId: string): Promise<{ stock: number }> } } }).botbond.commerce.getInventory("lap-1");
    expect(afterRecord.stock).toBe(before);
    expect((await repository.getSession(session.sessionId))?.state).toBe("EXPIRED");
    const receipt = (await repository.getSession(session.sessionId))?.receipt;
    expect(receipt?.usageChargedAtomic).toBe("3000");
    expect(receipt?.transactions.map((transaction) => transaction.kind)).toEqual(["PAYMENT", "BOND"]);
    expect(bond.expirySettlementRequests).toEqual([{ sessionId: session.sessionId, penaltyAtomic: "200000" }]);
    await app.close();
  });

  it("rejects cross-session reservation finalization", async () => {
    const { app } = await setup();
    const firstIntent = await createIntent(app, "Compare 20 laptops and reserve the best one for 60 seconds");
    const first = (await createSession(app, firstIntent, { bondAccount: "fake-bond-ok" })).json();
    const firstHeaders = { authorization: `Bearer ${first.token}` };
    const reservation = (await app.inject({ method: "POST", url: `/v1/access/${first.sessionId}/reservations`, headers: firstHeaders, payload: { productId: "lap-1", quantity: 1 } })).json();
    const secondIntent = await createIntent(app, "Compare 20 laptops and reserve the best one for 60 seconds");
    const second = (await createSession(app, secondIntent, { bondAccount: "fake-bond-ok" })).json();
    const response = await app.inject({ method: "POST", url: `/v1/access/${second.sessionId}/reservations/${reservation.reservationId}/release`, headers: { authorization: `Bearer ${second.token}` } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("RESERVATION_SESSION_MISMATCH");
    await app.close();
  });

  it("requires token for close, receipt, and events", async () => {
    const { app } = await setup();
    const intent = await createIntent(app, "Compare laptop prices and stock only");
    const session = (await createSession(app, intent)).json();
    expect((await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/close`, headers: { "idempotency-key": "unauthorized-close" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/sessions/${session.sessionId}/receipt` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/sessions/${session.sessionId}/events` })).statusCode).toBe(401);
    const events = await app.inject({ method: "GET", url: `/v1/sessions/${session.sessionId}/events`, headers: { authorization: `Bearer ${session.token}` } });
    expect(events.statusCode).toBe(200);
    expect(events.json().events.length).toBeGreaterThan(0);
    const policyEvent = events.json().events.find((event: { type: string }) => event.type === "POLICY_COMPILED");
    expect(policyEvent.data.policy).toEqual(intent.policy);
    expect(policyEvent.data.excludedPermissions).toEqual([]);
    expect(policyEvent.data.fixtureMarker).toBe("FAKE_COMPILER_FIXTURE");
    await app.close();
  });

  it("rejects expired token, invalid state transition, and validates SSE envelopes", async () => {
    const { app, clock, repository } = await setup({ tokenTtlMs: 1000 });
    const intent = await createIntent(app, "Compare laptop prices and stock only");
    const session = (await createSession(app, intent)).json();
    clock.advance(1001);
    const response = await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/products`, headers: { authorization: `Bearer ${session.token}` } });
    expect(response.statusCode).toBe(401);
    await expect(repository.transitionSession(session.sessionId, "ACTIVE", "BONDED")).rejects.toThrow("INVALID_STATE_TRANSITION");
    const sse = await app.inject({ method: "GET", url: `/v1/sessions/${session.sessionId}/events`, headers: { accept: "text/event-stream", authorization: `Bearer ${session.token}` } });
    expect(sse.statusCode).toBe(401);
    for (const event of await repository.listEvents(session.sessionId)) expect(validateEvent(event).valid).toBe(true);
    await app.close();
  });

  it("redacts credentials, proofs, tokens, and keys", () => {
    expect(redact({ paymentCredential: "pay", token: "tok", nested: { privateKey: "key", safe: "ok" } })).toEqual({ paymentCredential: "[REDACTED]", token: "[REDACTED]", nested: { privateKey: "[REDACTED]", safe: "ok" } });
  });

  it("fake adapter contract responses carry marker", async () => {
    const payment = new FakePaymentAdapter();
    const bond = new FakeBondAdapter();
    expect((await payment.createChallenge({ sessionId: "s", usageCapAtomic: "1" })).fixtureMarker).toBe("FAKE_ADAPTER_FIXTURE");
    expect((await payment.verifyCredential({ sessionId: "s", credential: "fake-payment-ok" })).status).toBe("CONFIRMED");
    expect((await bond.verifyOpenBond({ sessionId: "s", bondAccount: "fake-bond-ok", policyHash: "h", amountAtomic: "10", maxPenaltyAtomic: "3" })).fixtureMarker).toBe("FAKE_ADAPTER_FIXTURE");
  });

  it("documents TypeScript fixture parity", () => {
    expect(goldenPolicy.policyId).toBe("pol_golden_reservation_v1");
  });
});
