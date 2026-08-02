import { buildApp } from "../src/app.js";
import { ManualClock } from "../src/clock.js";
import { FakeBondAdapter, FakePaymentAdapter } from "../src/adapters.js";
import { FakeIntentCompiler, HttpIntentCompiler } from "../src/compiler.js";
import { InMemoryRepository } from "../src/repository.js";

const clock = new ManualClock(new Date());
const repository = new InMemoryRepository();
const bond = new FakeBondAdapter();
const app = await buildApp({ repository, clock, paymentAdapter: new FakePaymentAdapter(), bondAdapter: bond, intentCompiler: process.env.INTENT_COMPILER_URL ? new HttpIntentCompiler(process.env.INTENT_COMPILER_URL) : new FakeIntentCompiler(clock) });

const intentResponse = await app.inject({
  method: "POST",
  url: "/v1/intents",
  payload: {
    task: "Compare 20 laptops and reserve the best one for 60 seconds. Do not collect seller contacts.",
    agentWallet: "DemoAgentWallet1111111111111111111111111111",
    budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" },
  },
});
if (intentResponse.statusCode !== 200) throw new Error(intentResponse.body);
const intent = intentResponse.json();
console.log("1 intent compiled", { intentId: intent.intentId, policyHash: intent.policyHash, fixtureMarker: intent.validationMetadata.fixtureMarker });

const sessionResponse = await app.inject({
  method: "POST",
  url: "/v1/sessions",
  headers: { "idempotency-key": "e2e-create-normal" },
  payload: { intentId: intent.intentId, policyHash: intent.policyHash, paymentCredential: "fake-payment-ok", bondAccount: "fake-bond-ok" },
});
if (sessionResponse.statusCode !== 200) throw new Error(sessionResponse.body);
const session = sessionResponse.json();
const headers = { authorization: `Bearer ${session.token}` };
console.log("2 session ACTIVE", { sessionId: session.sessionId, fakeAdapters: true });

const products = await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/products`, headers });
if (products.statusCode !== 200) throw new Error(`protected product call failed: ${products.body}`);
console.log("3 paid protected product call", { status: products.statusCode, products: products.json().length });

const reservationResponse = await app.inject({ method: "POST", url: `/v1/access/${session.sessionId}/reservations`, headers, payload: { productId: "lap-1", quantity: 1 } });
if (reservationResponse.statusCode !== 200) throw new Error(`reservation failed: ${reservationResponse.body}`);
const reservation = reservationResponse.json();
console.log("4 bonded reservation", { status: reservationResponse.statusCode, reservationId: reservation.reservationId });

const denied = await app.inject({ method: "GET", url: `/v1/access/${session.sessionId}/seller-contacts`, headers });
console.log("5 forbidden path denied without penalty", { status: denied.statusCode, code: denied.json().error.code, penaltyAtomic: "0" });

await app.inject({ method: "POST", url: `/v1/access/${session.sessionId}/reservations/${reservation.reservationId}/release`, headers });
const closeResponse = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/close`, headers: { ...headers, "idempotency-key": "e2e-close-normal" } });
if (closeResponse.statusCode !== 200) throw new Error(`normal close failed: ${closeResponse.body}`);
console.log("6 normal release + close receipt", closeResponse.json());

const abandonedIntent = (await app.inject({
  method: "POST",
  url: "/v1/intents",
  payload: { task: "Compare and reserve one laptop for 60 seconds", agentWallet: "AbandonedAgentWallet111111111111111111111111", budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" } },
})).json();
const abandoned = (await app.inject({
  method: "POST",
  url: "/v1/sessions",
  headers: { "idempotency-key": "e2e-create-abandoned" },
  payload: { intentId: abandonedIntent.intentId, policyHash: abandonedIntent.policyHash, paymentCredential: "fake-payment-ok", bondAccount: "fake-bond-ok" },
})).json();
const abandonedHeaders = { authorization: `Bearer ${abandoned.token}` };
const abandonedReservationResponse = await app.inject({ method: "POST", url: `/v1/access/${abandoned.sessionId}/reservations`, headers: abandonedHeaders, payload: { productId: "lap-2", quantity: 1 } });
if (abandonedReservationResponse.statusCode !== 200) throw new Error(`abandoned reservation failed: ${abandonedReservationResponse.body}`);
const abandonedReservation = abandonedReservationResponse.json();
clock.advance(60_001);
const expired = await app.inject({ method: "POST", url: `/v1/access/${abandoned.sessionId}/reservations/${abandonedReservation.reservationId}/expire`, headers: abandonedHeaders });
if (expired.statusCode !== 200) throw new Error(`reservation expiry failed: ${expired.body}`);
const events = (await app.inject({ method: "GET", url: `/v1/sessions/${abandoned.sessionId}/events`, headers: abandonedHeaders })).json().events;
console.log("7 abandoned reservation expired", { status: expired.statusCode, settlement: bond.expirySettlementRequests.at(-1), eventTypes: events.map((event: { type: string }) => event.type) });

await app.close();
