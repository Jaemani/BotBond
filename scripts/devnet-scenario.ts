/**
 * devnet 증빙 시나리오 — 프로그램이 배포된 상태에서 실행:
 *   1) demo mint 생성 + agent ATA 민팅
 *   2) bond #1: open → close_valid (전액 환불) + 같은 evidence 재정산 시도(replay) 거부
 *   3) bond #2: open → settle_violation (제한 penalty + 잔액 환불)
 * 각 tx의 서명·Explorer 링크를 stdout(JSON lines)과 docs/c/solana-evidence.md 표에 기록.
 *
 * 실행: scripts/devnet-evidence.sh 경유 (또는 ANCHOR_PROVIDER_URL/ANCHOR_WALLET 지정 후 ts-mocha 아님 — ts-node 없음,
 *       mocha 러너 재사용을 위해 이 파일은 순수 함수 main()을 export하고 셸에서 node --loader 대신 ts-mocha로 돌리지 않는다.)
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { appendFileSync } from "fs";
import { join } from "path";
import {
  BotBondClient,
  SolanaBondAdapter,
  SettlementAuthorizationEvidence,
  canonicalReceiptHash,
  explorerTxUrl,
} from "../packages/payment-client/src";
import { createHmac } from "crypto";

const HMAC_SECRET = process.env.BOTBOND_EVIDENCE_SECRET ?? "devnet-demo-secret";
const BOND = 1_000_000n;
const MAX_PENALTY = 500_000n;
const CLUSTER = process.env.BOTBOND_CLUSTER ?? "devnet";
const EVIDENCE_MD = join(__dirname, "..", "docs", "c", "solana-evidence.md");

function nowKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " KST";
}

function logRow(instruction: string, sig: string, note: string) {
  const url = explorerTxUrl(sig, CLUSTER);
  console.log(JSON.stringify({ instruction, signature: sig, explorer: url, note }));
  if (CLUSTER === "devnet") {
    appendFileSync(
      EVIDENCE_MD,
      `| ${nowKst()} | ${instruction} | \`${sig.slice(0, 20)}…\` | ${url} | ${note} |\n`
    );
  }
}

function evidenceFor(args: {
  outcome: "valid_close" | "expired_reservation";
  policyHash: string;
  penaltyAtomic: string;
  refundAtomic: string;
  nonce: string;
  reservationId?: string;
}): SettlementAuthorizationEvidence {
  const payload = {
    outcome: args.outcome,
    policyHash: args.policyHash,
    penaltyAtomic: args.penaltyAtomic,
    refundAtomic: args.refundAtomic,
    reservationId: args.reservationId ?? null,
    nonce: args.nonce,
  };
  const evidenceHash = canonicalReceiptHash(payload);
  return {
    evidenceHash,
    authority: "gateway-local",
    nonce: args.nonce,
    issuedAt: new Date().toISOString(),
    outcome: args.outcome,
    policyHash: args.policyHash,
    penaltyAtomic: args.penaltyAtomic,
    refundAtomic: args.refundAtomic,
    reservationId: args.reservationId,
    signature: createHmac("sha256", HMAC_SECRET).update(`${evidenceHash}.${args.nonce}`).digest("hex"),
  };
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.botbond as anchor.Program;
  const client = new BotBondClient(program, CLUSTER);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const agent = payer;
  const merchant = Keypair.generate();
  const authority = Keypair.generate();
  const adapter = new SolanaBondAdapter({
    client,
    settlementAuthority: authority,
    evidenceHmacSecret: HMAC_SECRET,
  });

  console.log(JSON.stringify({ programId: program.programId.toBase58(), cluster: CLUSTER }));

  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
  const agentAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, agent.publicKey);
  await mintTo(provider.connection, payer, mint, agentAta.address, payer, 10_000_000n);
  await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, merchant.publicKey);
  console.log(JSON.stringify({ demoMint: mint.toBase58() }));

  const runTag = Date.now().toString();

  // ── bond #1: open → valid close (전액 환불) ──
  const policy1 = new Uint8Array(Buffer.from(canonicalReceiptHash({ policy: "demo-1", runTag }), "hex"));
  const open1 = await client.openBond({
    agent, merchant: merchant.publicKey, settlementAuthority: authority.publicKey, mint,
    policyHash: policy1, sessionNonce: BigInt(runTag) % 1_000_000_000n,
    bondAmountAtomic: BOND, maxPenaltyAtomic: MAX_PENALTY,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  logRow("open_bond (#1)", open1.signature, `bond=${BOND} escrow, session=${open1.session.slice(0, 8)}…`);

  const policy1Hex = `sha256:${Buffer.from(policy1).toString("hex")}`;
  const v1 = await adapter.verifyOpenBond({
    sessionId: `demo-${runTag}-1`, bondAccount: open1.session, policyHash: policy1Hex,
    amountAtomic: BOND.toString(), maxPenaltyAtomic: MAX_PENALTY.toString(),
  });
  if (v1.status !== "CONFIRMED") throw new Error(`verifyOpenBond: ${JSON.stringify(v1)}`);

  const ev1 = evidenceFor({
    outcome: "valid_close", policyHash: policy1Hex, penaltyAtomic: "0",
    refundAtomic: BOND.toString(), nonce: `close-${runTag}`,
  });
  const close1 = await adapter.requestValidClose({
    sessionId: `demo-${runTag}-1`, policyHash: policy1Hex, amountAtomic: BOND.toString(), evidence: ev1,
  });
  if (close1.status !== "CONFIRMED") throw new Error(`requestValidClose: ${JSON.stringify(close1)}`);
  logRow("close_valid (#1)", close1.providerReference!, `full refund ${close1.bondRefundedAtomic}, receipt=evidence hash`);

  // replay: 같은 세션에 새 evidence로 재정산 시도 → 온체인 status 게이트가 거부 (delivery #9)
  const freshAdapter = new SolanaBondAdapter({ client, settlementAuthority: authority, evidenceHmacSecret: HMAC_SECRET });
  await freshAdapter.verifyOpenBond({
    sessionId: `demo-${runTag}-1r`, bondAccount: open1.session, policyHash: policy1Hex,
    amountAtomic: BOND.toString(), maxPenaltyAtomic: MAX_PENALTY.toString(),
  }); // BOND_NOT_OPEN 예상 — 등록 안 되므로 아래는 conflict 경로 검증용 수동 등록
  (freshAdapter as any).sessions.set(`demo-${runTag}-1r`, new PublicKey(open1.session));
  const replay = await freshAdapter.requestValidClose({
    sessionId: `demo-${runTag}-1r`, policyHash: policy1Hex, amountAtomic: BOND.toString(),
    evidence: evidenceFor({
      outcome: "valid_close", policyHash: policy1Hex, penaltyAtomic: "0",
      refundAtomic: BOND.toString(), nonce: `replay-${runTag}`,
    }),
  });
  console.log(JSON.stringify({ replayAttempt: replay }));
  if (replay.status !== "FAILED" || replay.failureCode !== "SETTLEMENT_CONFLICT") {
    throw new Error("replay was not rejected — invariant broken");
  }
  if (CLUSTER === "devnet") {
    appendFileSync(EVIDENCE_MD, `| ${nowKst()} | (replay 시도 #1) | — | — | 이중정산 거부: \`SETTLEMENT_CONFLICT\` (온체인 status 게이트, tx 미발생) |\n`);
  }

  // ── bond #2: open → expired reservation settlement (제한 penalty) ──
  const policy2 = new Uint8Array(Buffer.from(canonicalReceiptHash({ policy: "demo-2", runTag }), "hex"));
  const open2 = await client.openBond({
    agent, merchant: merchant.publicKey, settlementAuthority: authority.publicKey, mint,
    policyHash: policy2, sessionNonce: (BigInt(runTag) % 1_000_000_000n) + 1n,
    bondAmountAtomic: BOND, maxPenaltyAtomic: MAX_PENALTY,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  logRow("open_bond (#2)", open2.signature, `bond=${BOND} escrow, session=${open2.session.slice(0, 8)}…`);

  const policy2Hex = `sha256:${Buffer.from(policy2).toString("hex")}`;
  await adapter.verifyOpenBond({
    sessionId: `demo-${runTag}-2`, bondAccount: open2.session, policyHash: policy2Hex,
    amountAtomic: BOND.toString(), maxPenaltyAtomic: MAX_PENALTY.toString(),
  });
  const penalty = 300_000n;
  const settle2 = await adapter.requestExpiredReservationSettlement({
    sessionId: `demo-${runTag}-2`, policyHash: policy2Hex,
    penaltyAtomic: penalty.toString(), maxPenaltyAtomic: MAX_PENALTY.toString(),
    bondAmountAtomic: BOND.toString(), reservationId: `resv-${runTag}`,
    evidence: evidenceFor({
      outcome: "expired_reservation", policyHash: policy2Hex,
      penaltyAtomic: penalty.toString(), refundAtomic: (BOND - penalty).toString(),
      nonce: `expiry-${runTag}`, reservationId: `resv-${runTag}`,
    }),
  });
  if (settle2.status !== "CONFIRMED") throw new Error(`expiry settlement: ${JSON.stringify(settle2)}`);
  logRow(
    "settle_violation (#2)", settle2.providerReference!,
    `penalty=${settle2.penaltyAtomic} → merchant, refund=${settle2.bondRefundedAtomic} → agent (보존식 성립)`
  );

  console.log(JSON.stringify({ done: true, evidenceDoc: CLUSTER === "devnet" ? EVIDENCE_MD : "(local run: md 기록 생략)" }));
}

// ts-node 미설치 환경이라 ts-mocha 러너로 실행한다 (scripts/devnet-evidence.sh).
describe("devnet evidence scenario", function () {
  this.timeout(600_000);
  it("open→close full refund / replay rejected / open→bounded penalty", async () => {
    await main();
  });
});
