import { Connection } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";

const gateway = (process.env.BOTBOND_GATEWAY_URL ?? "https://botbond-gateway-752329931962.us-central1.run.app").replace(/\/$/, "");
const behavior = (process.argv[2] ?? "normal") as "normal" | "scope-denied" | "abandon";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${gateway}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}:${response.status}:${text}`);
  return text ? JSON.parse(text) as T : {} as T;
}

const run = await request<{
  runId: string;
  sessionId: string;
  token: string;
  openTransaction: { signature: string; explorerUrl: string };
}>("/v1/public-demo-runs", { method: "POST", body: JSON.stringify({ behavior }) });
const auth = { "x-botbond-session-token": run.token };
const base = `/v1/access/${run.sessionId}`;
await request(`${base}/products`, { headers: auth });
if (behavior === "scope-denied") {
  const response = await fetch(`${gateway}${base}/seller-contacts`, { headers: auth });
  if (response.status !== 403) throw new Error(`EXPECTED_403:${response.status}`);
} else {
  await request(`${base}/products/lap-2/inventory`, { headers: auth });
  const reservation = await request<{ reservationId: string; expiresAt: string }>(`${base}/reservations`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ productId: "lap-2", quantity: 1 }),
  });
  if (behavior === "normal") {
    await request(`${base}/reservations/${reservation.reservationId}/release`, { method: "POST", headers: auth, body: "{}" });
  } else {
    const waitMs = Math.max(0, new Date(reservation.expiresAt).getTime() - Date.now() + 1_250);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    await request(`${base}/reservations/${reservation.reservationId}/expire`, { method: "POST", headers: auth, body: "{}" });
  }
}

let receipt: {
  outcome: string;
  penaltyAtomic: string;
  bondRefundedAtomic: string;
  receiptHash: string;
  transactions: Array<{ kind: string; providerReference?: string; fixtureMarker?: string }>;
};
if (behavior === "abandon") {
  receipt = await request(`/v1/sessions/${run.sessionId}/receipt`, { headers: auth });
} else {
  receipt = await request(`/v1/sessions/${run.sessionId}/close`, {
    method: "POST",
    headers: { ...auth, "idempotency-key": `verify-${run.runId}` },
    body: "{}",
  });
}
const settlement = receipt.transactions.find((transaction) => transaction.kind === "BOND" && !transaction.fixtureMarker)?.providerReference;
if (!settlement) throw new Error("REAL_SETTLEMENT_SIGNATURE_REQUIRED");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const statuses = await connection.getSignatureStatuses([run.openTransaction.signature, settlement], { searchTransactionHistory: true });
if (statuses.value.some((status) => !status || status.err)) throw new Error("DEVNET_SIGNATURE_NOT_CONFIRMED");

mkdirSync(".secrets", { recursive: true });
writeFileSync(".secrets/latest-public-run.json", JSON.stringify({
  sessionId: run.sessionId,
  token: run.token,
  webUrl: `https://botbond-bshop.vercel.app/agent?sessionId=${encodeURIComponent(run.sessionId)}&token=${encodeURIComponent(run.token)}&gateway=%2Fgateway&scenario=${encodeURIComponent(behavior)}`,
}, null, 2));

console.log(JSON.stringify({
  behavior,
  sessionId: run.sessionId,
  outcome: receipt.outcome,
  penaltyAtomic: receipt.penaltyAtomic,
  bondRefundedAtomic: receipt.bondRefundedAtomic,
  receiptHash: receipt.receiptHash,
  openTransaction: run.openTransaction.explorerUrl,
  settlementTransaction: `https://explorer.solana.com/tx/${settlement}?cluster=devnet`,
  confirmations: statuses.value.map((status) => status?.confirmationStatus),
  privateCaptureState: ".secrets/latest-public-run.json",
}, null, 2));
