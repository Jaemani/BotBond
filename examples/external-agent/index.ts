import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BotBondClient, explorerTxUrl } from "../../packages/payment-client/src/index.ts";

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback) return fallback;
  throw new Error(`Missing --${name}`);
}

const gateway = argument("gateway", "https://botbond-gateway-752329931962.us-central1.run.app").replace(/\/$/, "");
const walletPath = argument("wallet", `${process.env.HOME}/.config/solana/id.json`);
const rpcUrl = argument("rpc", "https://api.devnet.solana.com");
const walletBytes = JSON.parse(readFileSync(walletPath, "utf8")) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(walletBytes));
const connection = new Connection(rpcUrl, "confirmed");
if (await connection.getBalance(payer.publicKey) < 20_000_000) {
  throw new Error(`Wallet ${payer.publicKey.toBase58()} needs devnet SOL. Run: solana airdrop 1 ${payer.publicKey.toBase58()} --url devnet`);
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${gateway}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${body}`);
  return body ? JSON.parse(body) as T : {} as T;
}

const discovery = await requestJson<{
  bond: { programId: string; publicDemoMerchant?: string };
  payment: { devnetCredentialEndpoint?: string };
}>("/.well-known/agent-access");
if (!discovery.payment.devnetCredentialEndpoint) throw new Error("DEVNET_CREDENTIAL_ENDPOINT_NOT_AVAILABLE");
if (!discovery.bond.publicDemoMerchant) throw new Error("PUBLIC_DEMO_MERCHANT_NOT_PUBLISHED");

const task = "Compare laptop price and live inventory, reserve one last unit, and do not access seller contacts or reviews.";
const intent = await requestJson<{
  intentId: string;
  policyHash: string;
  policy: {
    constraints: {
      usageCapAtomic: string;
      bondAmountAtomic: string;
      maxPenaltyAtomic: string;
      expiresAt: string;
    };
  };
}>("/v1/intents", {
  method: "POST",
  body: JSON.stringify({
    task,
    agentWallet: payer.publicKey.toBase58(),
    budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" },
  }),
});

const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync("packages/payment-client/idl/botbond.json", "utf8")) as anchor.Idl;
const client = new BotBondClient(new anchor.Program(idl, provider), "devnet");
const merchant = new PublicKey(discovery.bond.publicDemoMerchant);
const mint = await createMint(connection, payer, payer.publicKey, null, 6);
const agentToken = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
await getOrCreateAssociatedTokenAccount(connection, payer, mint, merchant);
await mintTo(connection, payer, mint, agentToken.address, payer, BigInt(intent.policy.constraints.bondAmountAtomic));
const policyHashBytes = Uint8Array.from(Buffer.from(intent.policyHash.slice("sha256:".length), "hex"));
const opened = await client.openBond({
  agent: payer,
  merchant,
  settlementAuthority: new PublicKey("GMrS1AR2MmHvW9cDmQJ4RApQz6iTS17srfb8bwucJQa6"),
  mint,
  policyHash: policyHashBytes,
  sessionNonce: BigInt(Date.now()),
  bondAmountAtomic: BigInt(intent.policy.constraints.bondAmountAtomic),
  maxPenaltyAtomic: BigInt(intent.policy.constraints.maxPenaltyAtomic),
  expiresAt: new Date(intent.policy.constraints.expiresAt),
});

const sessionId = `ses_external_${crypto.randomUUID()}`;
const challenge = await requestJson<{ challenge: string }>("/v1/payment-challenges", {
  method: "POST",
  body: JSON.stringify({ intentId: intent.intentId, sessionId }),
});
const credential = await requestJson<{ credential: string; mode: string }>(discovery.payment.devnetCredentialEndpoint, {
  method: "POST",
  body: JSON.stringify({ intentId: intent.intentId, sessionId }),
});
const session = await requestJson<{ token: string }>("/v1/sessions", {
  method: "POST",
  headers: { "idempotency-key": `external-${sessionId}` },
  body: JSON.stringify({
    sessionId,
    intentId: intent.intentId,
    policyHash: intent.policyHash,
    paymentChallenge: challenge.challenge,
    paymentCredential: credential.credential,
    bondAccount: opened.session,
  }),
});
const headers = { "x-botbond-session-token": session.token };
await requestJson(`/v1/access/${sessionId}/products`, { headers });
await requestJson(`/v1/access/${sessionId}/products/lap-2/inventory`, { headers });
const reservation = await requestJson<{ reservationId: string }>(`/v1/access/${sessionId}/reservations`, {
  method: "POST",
  headers,
  body: JSON.stringify({ productId: "lap-2", quantity: 1 }),
});
await requestJson(`/v1/access/${sessionId}/reservations/${reservation.reservationId}/release`, {
  method: "POST",
  headers,
  body: "{}",
});
const receipt = await requestJson<{
  outcome: string;
  usageChargedAtomic: string;
  bondRefundedAtomic: string;
  transactions: Array<{ kind: string; providerReference?: string; fixtureMarker?: string }>;
}>(`/v1/sessions/${sessionId}/close`, {
  method: "POST",
  headers: { ...headers, "idempotency-key": `external-close-${sessionId}` },
  body: "{}",
});
const settlement = receipt.transactions.find((entry) => entry.kind === "BOND" && !entry.fixtureMarker)?.providerReference;
if (!settlement) throw new Error("REAL_SETTLEMENT_TRANSACTION_REQUIRED");

console.log(JSON.stringify({
  agent: payer.publicKey.toBase58(),
  sessionId,
  policyHash: intent.policyHash,
  paymentMode: credential.mode,
  bondOpen: explorerTxUrl(opened.signature, "devnet"),
  settlement: explorerTxUrl(settlement, "devnet"),
  outcome: receipt.outcome,
  usageChargedAtomic: receipt.usageChargedAtomic,
  bondRefundedAtomic: receipt.bondRefundedAtomic,
}, null, 2));
