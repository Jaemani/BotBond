import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { validateEvent } from "@botbond/contracts";
import { BotBondClient } from "../../../packages/payment-client/src/index.ts";
import { CappedSessionPaymentAdapter } from "../../../packages/payment-client/src/payment-adapter.ts";
import { SolanaBondAdapter } from "../../../packages/payment-client/src/bond-adapter.ts";
import { buildApp } from "../src/app.ts";
import { ManualClock } from "../src/clock.ts";
import { FakeIntentCompiler } from "../src/compiler.ts";
import { InMemoryRepository } from "../src/repository.ts";
import { replay } from "../../web/lib/reducer.ts";

const PAYMENT_SECRET = "test-only-abc-payment-secret";
const EVIDENCE_SECRET = "test-only-abc-evidence-secret";
const SESSION_ID = "ses_abc_local_0001";
const EXPIRED_SESSION_ID = "ses_abc_local_expired_0002";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.botbond as anchor.Program;
const payer = (provider.wallet as anchor.Wallet).payer;
const merchant = Keypair.generate();
const clock = new ManualClock(new Date());
const repository = new InMemoryRepository();
const client = new BotBondClient(program, "custom");
const payment = new CappedSessionPaymentAdapter({
  hmacSecret: PAYMENT_SECRET,
  unitPriceAtomic: "1000",
});
const bond = new SolanaBondAdapter({
  client,
  settlementAuthority: payer,
  evidenceHmacSecret: EVIDENCE_SECRET,
});
const app = await buildApp({
  repository,
  clock,
  paymentAdapter: payment,
  bondAdapter: bond,
  intentCompiler: new FakeIntentCompiler(clock),
  settlementSigningSecret: EVIDENCE_SECRET,
  settlementAuthority: payer.publicKey.toBase58(),
  settlementPolling: { attempts: 20, intervalMs: 500 },
});

try {
  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
  const agentToken = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey,
  );
  await mintTo(provider.connection, payer, mint, agentToken.address, payer, 10_000_000n);
  await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, merchant.publicKey);

  const intentResponse = await app.inject({
    method: "POST",
    url: "/v1/intents",
    payload: {
      task: "Compare 20 laptops, reserve the best one for 60 seconds, and do not collect seller contacts.",
      agentWallet: payer.publicKey.toBase58(),
      budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" },
    },
  });
  if (intentResponse.statusCode !== 200) throw new Error(`intent failed: ${intentResponse.body}`);
  const intent = intentResponse.json();
  const policyHashBytes = Uint8Array.from(Buffer.from(intent.policyHash.slice("sha256:".length), "hex"));
  const opened = await client.openBond({
    agent: payer,
    merchant: merchant.publicKey,
    settlementAuthority: payer.publicKey,
    mint,
    policyHash: policyHashBytes,
    sessionNonce: 900_001n,
    bondAmountAtomic: BigInt(intent.policy.constraints.bondAmountAtomic),
    maxPenaltyAtomic: BigInt(intent.policy.constraints.maxPenaltyAtomic),
    expiresAt: new Date(clock.now().getTime() + 3_600_000),
  });

  const challenge = await payment.createChallenge({
    sessionId: SESSION_ID,
    usageCapAtomic: intent.policy.constraints.usageCapAtomic,
  });
  if (challenge.status !== "CONFIRMED" || !challenge.challenge) {
    throw new Error("payment challenge failed");
  }
  const credential = payment.issueCredential(SESSION_ID, intent.policy.constraints.usageCapAtomic);
  const sessionResponse = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { "idempotency-key": "abc-create-session" },
    payload: {
      sessionId: SESSION_ID,
      intentId: intent.intentId,
      policyHash: intent.policyHash,
      paymentChallenge: challenge.challenge,
      paymentCredential: credential,
      bondAccount: opened.session,
    },
  });
  if (sessionResponse.statusCode !== 200) throw new Error(`session failed: ${sessionResponse.body}`);
  const session = sessionResponse.json();
  const authorization = { authorization: `Bearer ${session.token}` };

  const products = await app.inject({
    method: "GET",
    url: `/v1/access/${SESSION_ID}/products`,
    headers: authorization,
  });
  if (products.statusCode !== 200) throw new Error(`products failed: ${products.body}`);

  const reservationResponse = await app.inject({
    method: "POST",
    url: `/v1/access/${SESSION_ID}/reservations`,
    headers: authorization,
    payload: { productId: "lap-1", quantity: 1 },
  });
  if (reservationResponse.statusCode !== 200) throw new Error(`reservation failed: ${reservationResponse.body}`);
  const reservation = reservationResponse.json();

  const denied = await app.inject({
    method: "GET",
    url: `/v1/access/${SESSION_ID}/seller-contacts`,
    headers: authorization,
  });
  if (denied.statusCode !== 403) throw new Error(`denial failed: ${denied.body}`);

  const release = await app.inject({
    method: "POST",
    url: `/v1/access/${SESSION_ID}/reservations/${reservation.reservationId}/release`,
    headers: authorization,
  });
  if (release.statusCode !== 200) throw new Error(`release failed: ${release.body}`);

  const close = await app.inject({
    method: "POST",
    url: `/v1/sessions/${SESSION_ID}/close`,
    headers: { ...authorization, "idempotency-key": "abc-close-session" },
  });
  if (close.statusCode !== 200) throw new Error(`close failed: ${close.body}`);
  const receipt = close.json();

  const eventsResponse = await app.inject({
    method: "GET",
    url: `/v1/sessions/${SESSION_ID}/events`,
    headers: authorization,
  });
  if (eventsResponse.statusCode !== 200) throw new Error(`events failed: ${eventsResponse.body}`);
  const events = eventsResponse.json().events;
  for (const event of events) {
    const validation = validateEvent(event);
    if (!validation.valid) throw new Error(`invalid event: ${validation.errors.join(", ")}`);
  }

  const view = replay(events, events.length);
  const chainView = await client.fetchBondSession(new PublicKey(opened.session));
  const paymentEvent = events.find((event: { type: string }) => event.type === "PAYMENT_VERIFIED");
  const bondOpenedEvent = events.find((event: { type: string }) => event.type === "BOND_OPENED");
  const deniedEvent = events.find((event: { type: string }) => event.type === "REQUEST_DENIED");

  if (receipt.outcome !== "CLOSED") throw new Error("receipt outcome mismatch");
  if (receipt.usageChargedAtomic !== "3000") throw new Error(`usage mismatch: ${receipt.usageChargedAtomic}`);
  if (receipt.bondRefundedAtomic !== "1000000" || receipt.penaltyAtomic !== "0") {
    throw new Error("bond conservation mismatch");
  }
  if (chainView.status !== "CLOSED") throw new Error(`chain status mismatch: ${chainView.status}`);
  if (view.sessionState !== "CLOSED" || view.usageSpentAtomic !== 3000) {
    throw new Error("Role A reducer did not reach closed usage state");
  }
  if (view.penaltyAtomic !== 0 || view.bondRefundedAtomic !== 1_000_000) {
    throw new Error("Role A money state mismatch");
  }
  const denialTrace = view.trace.find((row) => row.kind === "DENIED");
  if (view.deniedCount !== 1 || denialTrace?.bondUnchanged !== true) {
    throw new Error("Role A denial state mismatch");
  }
  if (paymentEvent?.data.fixtureMarker || bondOpenedEvent?.data.fixtureMarker) {
    throw new Error("Role C adapter events must not contain fake adapter markers");
  }
  if (deniedEvent?.data.penaltyAtomic !== "0") throw new Error("denial moved bond");
  if (!view.txs.every((transaction) => transaction.explorerEligible)) {
    throw new Error("real Solana references must remain explorer eligible");
  }

  console.log("ABC localnet E2E passed", {
    sessionId: SESSION_ID,
    eventCount: events.length,
    usageChargedAtomic: receipt.usageChargedAtomic,
    bondRefundedAtomic: receipt.bondRefundedAtomic,
    chainStatus: chainView.status,
  });

  const expiredIntentResponse = await app.inject({
    method: "POST",
    url: "/v1/intents",
    payload: {
      task: "Compare laptops, reserve the best one for 60 seconds, and do not collect seller contacts.",
      agentWallet: payer.publicKey.toBase58(),
      budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" },
    },
  });
  if (expiredIntentResponse.statusCode !== 200) {
    throw new Error(`expired intent failed: ${expiredIntentResponse.body}`);
  }
  const expiredIntent = expiredIntentResponse.json();
  const expiredPolicyHashBytes = Uint8Array.from(
    Buffer.from(expiredIntent.policyHash.slice("sha256:".length), "hex"),
  );
  const expiredOpened = await client.openBond({
    agent: payer,
    merchant: merchant.publicKey,
    settlementAuthority: payer.publicKey,
    mint,
    policyHash: expiredPolicyHashBytes,
    sessionNonce: 900_002n,
    bondAmountAtomic: BigInt(expiredIntent.policy.constraints.bondAmountAtomic),
    maxPenaltyAtomic: BigInt(expiredIntent.policy.constraints.maxPenaltyAtomic),
    expiresAt: new Date(clock.now().getTime() + 3_600_000),
  });
  const expiredChallenge = await payment.createChallenge({
    sessionId: EXPIRED_SESSION_ID,
    usageCapAtomic: expiredIntent.policy.constraints.usageCapAtomic,
  });
  if (expiredChallenge.status !== "CONFIRMED" || !expiredChallenge.challenge) {
    throw new Error("expired payment challenge failed");
  }
  const expiredCredential = payment.issueCredential(
    EXPIRED_SESSION_ID,
    expiredIntent.policy.constraints.usageCapAtomic,
  );
  const expiredSessionResponse = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { "idempotency-key": "abc-create-expired-session" },
    payload: {
      sessionId: EXPIRED_SESSION_ID,
      intentId: expiredIntent.intentId,
      policyHash: expiredIntent.policyHash,
      paymentChallenge: expiredChallenge.challenge,
      paymentCredential: expiredCredential,
      bondAccount: expiredOpened.session,
    },
  });
  if (expiredSessionResponse.statusCode !== 200) {
    throw new Error(`expired session failed: ${expiredSessionResponse.body}`);
  }
  const expiredSession = expiredSessionResponse.json();
  const expiredAuthorization = { authorization: `Bearer ${expiredSession.token}` };

  const expiredProducts = await app.inject({
    method: "GET",
    url: `/v1/access/${EXPIRED_SESSION_ID}/products`,
    headers: expiredAuthorization,
  });
  if (expiredProducts.statusCode !== 200) {
    throw new Error(`expired products failed: ${expiredProducts.body}`);
  }
  const expiredReservationResponse = await app.inject({
    method: "POST",
    url: `/v1/access/${EXPIRED_SESSION_ID}/reservations`,
    headers: expiredAuthorization,
    payload: { productId: "lap-2", quantity: 1 },
  });
  if (expiredReservationResponse.statusCode !== 200) {
    throw new Error(`expired reservation failed: ${expiredReservationResponse.body}`);
  }
  const expiredReservation = expiredReservationResponse.json();
  const heldInventory = await repository.getInventory("lap-2");
  if (heldInventory?.stock !== 0) {
    throw new Error(`last-unit hold mismatch: ${heldInventory?.stock}`);
  }

  clock.advance(60_001);
  const expirationResponse = await app.inject({
    method: "POST",
    url: `/v1/access/${EXPIRED_SESSION_ID}/reservations/${expiredReservation.reservationId}/expire`,
    headers: expiredAuthorization,
  });
  if (expirationResponse.statusCode !== 200) {
    throw new Error(`expiration failed: ${expirationResponse.body}`);
  }
  const expiredReceiptResponse = await app.inject({
    method: "GET",
    url: `/v1/sessions/${EXPIRED_SESSION_ID}/receipt`,
    headers: expiredAuthorization,
  });
  if (expiredReceiptResponse.statusCode !== 200) {
    throw new Error(`expired receipt failed: ${expiredReceiptResponse.body}`);
  }
  const expiredReceipt = expiredReceiptResponse.json();
  const expiredEventsResponse = await app.inject({
    method: "GET",
    url: `/v1/sessions/${EXPIRED_SESSION_ID}/events`,
    headers: expiredAuthorization,
  });
  if (expiredEventsResponse.statusCode !== 200) {
    throw new Error(`expired events failed: ${expiredEventsResponse.body}`);
  }
  const expiredEvents = expiredEventsResponse.json().events;
  for (const event of expiredEvents) {
    const validation = validateEvent(event);
    if (!validation.valid) throw new Error(`invalid expired event: ${validation.errors.join(", ")}`);
  }
  const expiredView = replay(expiredEvents, expiredEvents.length);
  const expiredChainView = await client.fetchBondSession(new PublicKey(expiredOpened.session));
  const restoredInventory = await repository.getInventory("lap-2");

  if (expiredReceipt.outcome !== "EXPIRED") throw new Error("expired outcome mismatch");
  if (expiredReceipt.usageChargedAtomic !== "3000") {
    throw new Error(`expired usage mismatch: ${expiredReceipt.usageChargedAtomic}`);
  }
  if (expiredReceipt.penaltyAtomic !== "250000" || expiredReceipt.bondRefundedAtomic !== "750000") {
    throw new Error("expired bounded settlement mismatch");
  }
  if (expiredChainView.status !== "VIOLATED") {
    throw new Error(`expired chain status mismatch: ${expiredChainView.status}`);
  }
  if (expiredChainView.settledPenaltyAtomic !== "250000") {
    throw new Error(`expired chain penalty mismatch: ${expiredChainView.settledPenaltyAtomic}`);
  }
  if (restoredInventory?.stock !== 1) {
    throw new Error(`last-unit restore mismatch: ${restoredInventory?.stock}`);
  }
  if (
    expiredView.sessionState !== "EXPIRED" ||
    expiredView.penaltyAtomic !== 250_000 ||
    expiredView.bondRefundedAtomic !== 750_000
  ) {
    throw new Error("Role A expired settlement state mismatch");
  }
  if (!expiredView.txs.every((transaction) => transaction.explorerEligible)) {
    throw new Error("expired Solana reference must remain explorer eligible");
  }

  console.log("ABC localnet expiry E2E passed", {
    sessionId: EXPIRED_SESSION_ID,
    inventory: "1 -> 0 -> 1",
    usageChargedAtomic: expiredReceipt.usageChargedAtomic,
    penaltyAtomic: expiredReceipt.penaltyAtomic,
    bondRefundedAtomic: expiredReceipt.bondRefundedAtomic,
    chainStatus: expiredChainView.status,
  });
} finally {
  await app.close();
}
