import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";
import { Firestore } from "@google-cloud/firestore";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair } from "@solana/web3.js";
import { BotBondClient, CappedSessionPaymentAdapter, SolanaBondAdapter, explorerTxUrl } from "../packages/payment-client/src/index.ts";
import { FixtureMarkedPaymentAdapter } from "../apps/gateway/src/adapters.ts";
import { SystemClock } from "../apps/gateway/src/clock.ts";
import { DemoCommerceApi } from "../apps/gateway/src/commerce.ts";
import { processExpiredReservations } from "../apps/gateway/src/expiry-processor.ts";
import { FirestoreRepository } from "../apps/gateway/src/firestore-repository.ts";

const gateway = (process.env.BOTBOND_GATEWAY_URL ?? "https://botbond-gateway-pzooexj52a-uc.a.run.app").replace(/\/$/, "");
const web = (process.env.BOTBOND_WEB_URL ?? "https://botbond-web-pzooexj52a-uc.a.run.app").replace(/\/$/, "");
const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const walletPath = process.env.ANCHOR_WALLET ?? ".secrets/botbond-devnet.json";
const paymentSecret = process.env.BOTBOND_PAYMENT_SECRET;
const evidenceSecret = process.env.BOTBOND_EVIDENCE_SECRET;
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "botbond-demo-2026-jaeman";
if (!paymentSecret) throw new Error("BOTBOND_PAYMENT_SECRET_REQUIRED");
if (!evidenceSecret) throw new Error("BOTBOND_EVIDENCE_SECRET_REQUIRED");

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${gateway}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${body}`);
  return JSON.parse(body) as T;
};

const waitUntil = async (iso: string): Promise<void> => {
  const remaining = new Date(iso).getTime() - Date.now() + 1_500;
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const walletBytes = JSON.parse(readFileSync(walletPath, "utf8")) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(walletBytes));
const connection = new Connection(rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync("packages/payment-client/idl/botbond.json", "utf8")) as anchor.Idl;
const program = new anchor.Program(idl, provider);
const client = new BotBondClient(program, "devnet");
const merchant = Keypair.generate();

const task = "Compare laptop price and live inventory, reserve the best last unit for 60 seconds, and do not access seller contacts or customer reviews.";
const intent = await requestJson<{
  intentId: string;
  policyHash: string;
  policy: {
    constraints: { usageCapAtomic: string; bondAmountAtomic: string; maxPenaltyAtomic: string };
    bondedActions: Array<{ ttlSeconds: number }>;
  };
  validationMetadata: { compilerMode: string };
}>("/v1/intents", {
  method: "POST",
  body: JSON.stringify({
    task,
    agentWallet: payer.publicKey.toBase58(),
    budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" },
  }),
});
if (intent.validationMetadata.compilerMode !== "VERTEX_AI") throw new Error("VERTEX_AI_COMPILER_REQUIRED");
if (intent.policy.bondedActions.length === 0 || intent.policy.constraints.bondAmountAtomic === "0") {
  throw new Error("BONDED_POLICY_REQUIRED");
}

const mint = await createMint(connection, payer, payer.publicKey, null, 6);
const agentToken = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
await mintTo(connection, payer, mint, agentToken.address, payer, 10_000_000n);
await getOrCreateAssociatedTokenAccount(connection, payer, mint, merchant.publicKey);
const policyHashBytes = Uint8Array.from(Buffer.from(intent.policyHash.slice("sha256:".length), "hex"));
const opened = await client.openBond({
  agent: payer,
  merchant: merchant.publicKey,
  settlementAuthority: payer.publicKey,
  mint,
  policyHash: policyHashBytes,
  sessionNonce: BigInt(Date.now()),
  bondAmountAtomic: BigInt(intent.policy.constraints.bondAmountAtomic),
  maxPenaltyAtomic: BigInt(intent.policy.constraints.maxPenaltyAtomic),
  expiresAt: new Date(Date.now() + 30 * 60_000),
});

const sessionId = `ses_live_${randomUUID()}`;
const payment = new CappedSessionPaymentAdapter({ hmacSecret: paymentSecret, unitPriceAtomic: "1000" });
const paymentChallenge = await requestJson<{ challenge: string }>("/v1/payment-challenges", {
  method: "POST",
  body: JSON.stringify({ intentId: intent.intentId, sessionId }),
});
const paymentCredential = payment.issueCredential(sessionId, intent.policy.constraints.usageCapAtomic);
const session = await requestJson<{ sessionId: string; token: string; expiresAt: string }>("/v1/sessions", {
  method: "POST",
  headers: { "idempotency-key": `create-${sessionId}` },
  body: JSON.stringify({
    sessionId,
    intentId: intent.intentId,
    policyHash: intent.policyHash,
    paymentChallenge: paymentChallenge.challenge,
    paymentCredential,
    bondAccount: opened.session,
  }),
});
const auth = { authorization: `Bearer ${session.token}` };
const liveUrl = `${web}/?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(session.token)}`;
const privateStatePath = ".secrets/live-demo-session.json";
writeFileSync(privateStatePath, JSON.stringify({ sessionId, token: session.token, liveUrl, bondAccount: opened.session }, null, 2));
chmodSync(privateStatePath, 0o600);

await requestJson("/v1/access/" + sessionId + "/products", { headers: auth });
const inventoryBefore = await requestJson<{ stock: number }>(`/v1/access/${sessionId}/products/lap-2/inventory`, { headers: auth });
const reservation = await requestJson<{ reservationId: string; expiresAt: string }>(`/v1/access/${sessionId}/reservations`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ productId: "lap-2", quantity: 1 }),
});
const deniedResponse = await fetch(`${gateway}/v1/access/${sessionId}/seller-contacts`, { headers: auth });
if (deniedResponse.status !== 403) throw new Error(`SCOPE_DENIAL_REQUIRED:${deniedResponse.status}`);

console.log(JSON.stringify({
  phase: "ACTIVE",
  sessionId,
  compiler: intent.validationMetadata.compilerMode,
  policyHash: intent.policyHash,
  bondOpen: explorerTxUrl(opened.signature, "devnet"),
  inventory: `${inventoryBefore.stock} -> 0`,
  scopeDenied: 403,
  liveStateFile: privateStatePath,
}));

await waitUntil(reservation.expiresAt);
const repository = new FirestoreRepository(new Firestore({ projectId }), "botbond");
const workerClock = new SystemClock();
const commerce = new DemoCommerceApi(repository, workerClock);
await commerce.initialize();
const workerResults = await processExpiredReservations({
  repository,
  commerce,
  payment: new FixtureMarkedPaymentAdapter(payment),
  bond: new SolanaBondAdapter({ client, settlementAuthority: payer, evidenceHmacSecret: evidenceSecret }),
  clock: workerClock,
  settlementSigningSecret: evidenceSecret,
  settlementAuthority: payer.publicKey.toBase58(),
  async emit(event) {
    await repository.appendEvent({ ...event, eventId: `evt_${randomUUID()}`, occurredAt: workerClock.now().toISOString() });
  },
});
const workerResult = workerResults.find((entry) => entry.reservationId === reservation.reservationId);
if (workerResult?.status !== "EXPIRED") throw new Error(`EXPIRY_WORKER_FAILED:${JSON.stringify(workerResult)}`);
const receipt = await requestJson<{
  outcome: string;
  usageChargedAtomic: string;
  penaltyAtomic: string;
  bondRefundedAtomic: string;
  transactions: Array<{ kind: string; providerReference?: string; status: string; fixtureMarker?: string }>;
}>(`/v1/sessions/${sessionId}/receipt`, { headers: auth });
const bondTransaction = receipt.transactions.find((entry) => entry.kind === "BOND" && !entry.fixtureMarker);
if (!bondTransaction?.providerReference) throw new Error("REAL_BOND_TRANSACTION_REQUIRED");

console.log(JSON.stringify({
  phase: "SETTLED",
  sessionId,
  outcome: receipt.outcome,
  inventory: `${inventoryBefore.stock} -> 0 -> ${inventoryBefore.stock}`,
  usageChargedAtomic: receipt.usageChargedAtomic,
  penaltyAtomic: receipt.penaltyAtomic,
  bondRefundedAtomic: receipt.bondRefundedAtomic,
  settlement: explorerTxUrl(bondTransaction.providerReference, "devnet"),
  liveStateFile: privateStatePath,
}));
