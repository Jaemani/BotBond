/**
 * B 하니스(runPaymentAdapterContract/runBondAdapterContract) 병합 리허설 —
 * docs/09 "The harness checks" 8개 항목을 같은 이름·같은 순서로 로컬 재현한다.
 * 병합 후 B의 실제 하니스가 이 파일을 대체·검증한다 (이 파일은 C측 레플리카).
 *
 * 실행 전제: local validator + 프로그램 배포 (tests/bond-adapter.test.ts와 동일).
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { createHmac } from "crypto";
import { assert } from "chai";
import {
  AdapterResult,
  BotBondClient,
  CappedSessionPaymentAdapter,
  SolanaBondAdapter,
  SettlementAuthorizationEvidence,
  canonicalReceiptHash,
} from "../packages/payment-client/src";

const HMAC_SECRET = "local-slice-shared-secret";
const BOND = 1_000_000n;
const MAX_PENALTY = 500_000n;
const USAGE_CAP = "200000";

function assertStableEnvelope(r: AdapterResult, label: string) {
  assert.include(["PENDING", "CONFIRMED", "FAILED"], r.status, `${label}: status enum`);
  assert.isBoolean(r.retryable, `${label}: retryable boolean`);
  if (r.status === "FAILED") assert.isString(r.failureCode, `${label}: FAILED에는 failureCode`);
  if (r.status === "CONFIRMED") assert.isUndefined(r.failureCode, `${label}: CONFIRMED에 failureCode 없음`);
}

function makeEvidence(args: {
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

describe("adapter contract rehearsal (docs/09 harness checks 재현)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.botbond as anchor.Program;
  const client = new BotBondClient(program, "custom");
  const payer = (provider.wallet as anchor.Wallet).payer;
  const merchant = Keypair.generate();
  const authority = Keypair.generate();

  const bondAdapter = new SolanaBondAdapter({
    client,
    settlementAuthority: authority,
    evidenceHmacSecret: HMAC_SECRET,
  });
  const paymentAdapter = new CappedSessionPaymentAdapter({
    hmacSecret: HMAC_SECRET,
    unitPriceAtomic: "1000",
  });

  let mint: PublicKey;
  let nonceCounter = 90_000n;

  async function openAndVerify() {
    const policyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) policyBytes[i] = Math.floor(Math.random() * 256);
    const nonce = nonceCounter++;
    const res = await client.openBond({
      agent: payer,
      merchant: merchant.publicKey,
      settlementAuthority: authority.publicKey,
      mint,
      policyHash: policyBytes,
      sessionNonce: nonce,
      bondAmountAtomic: BOND,
      maxPenaltyAtomic: MAX_PENALTY,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const sessionId = `rehearsal-${nonce}`;
    const policyHash = `sha256:${Buffer.from(policyBytes).toString("hex")}`;
    const v = await bondAdapter.verifyOpenBond({
      sessionId,
      bondAccount: res.session,
      policyHash,
      amountAtomic: BOND.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    assert.equal(v.status, "CONFIRMED");
    return { sessionId, bondAccount: res.session, policyHash, verification: v };
  }

  before(async () => {
    mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey);
    await mintTo(provider.connection, payer, mint, ata.address, payer, 100_000_000n);
    await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, merchant.publicKey);
  });

  it("1. stable status envelope — 성공·실패 결과 전부 envelope 준수", async () => {
    const ch = await paymentAdapter.createChallenge({ sessionId: "rh-env", usageCapAtomic: USAGE_CAP });
    const bad = await paymentAdapter.createChallenge({ sessionId: "rh-env2", usageCapAtomic: "x" });
    const notFound = await bondAdapter.requestValidClose({
      sessionId: "rh-missing",
      policyHash: "sha256:" + "0".repeat(64),
      amountAtomic: BOND.toString(),
    });
    for (const [label, r] of [["challenge ok", ch], ["challenge bad", bad], ["close missing", notFound]] as const) {
      assertStableEnvelope(r, label);
    }
  });

  it("2. payment cap coverage — credential 한도가 정책 cap 커버 (activation 규칙)", async () => {
    const ch = await paymentAdapter.createChallenge({ sessionId: "rh-cap", usageCapAtomic: USAGE_CAP });
    const cred = paymentAdapter.issueCredential("rh-cap", USAGE_CAP);
    const v = await paymentAdapter.verifyCredential({
      sessionId: "rh-cap",
      credential: cred,
      challenge: ch.challenge,
    });
    assert.equal(v.status, "CONFIRMED");
    assert.exists(v.usageLimitAtomic);
    assert.isTrue(BigInt(v.usageLimitAtomic!) >= BigInt(USAGE_CAP));
  });

  it("3. usage settlement bounded by cap", async () => {
    const exact = await paymentAdapter.getUsageSettlement({ sessionId: "rh-u", calls: 20, usageCapAtomic: USAGE_CAP });
    assert.equal(exact.usageChargedAtomic, "20000");
    const over = await paymentAdapter.getUsageSettlement({ sessionId: "rh-u", calls: 5000, usageCapAtomic: USAGE_CAP });
    assert.isTrue(BigInt(over.usageChargedAtomic!) <= BigInt(USAGE_CAP));
  });

  it("4. bond amount and max penalty match policy — 불일치 거부", async () => {
    const opened = await openAndVerify();
    assert.equal(opened.verification.bondAmountAtomic, BOND.toString());
    assert.equal(opened.verification.maxPenaltyAtomic, MAX_PENALTY.toString());
    const mismatch = await bondAdapter.verifyOpenBond({
      sessionId: `${opened.sessionId}-mm`,
      bondAccount: opened.bondAccount,
      policyHash: opened.policyHash,
      amountAtomic: (BOND + 1n).toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    assert.equal(mismatch.status, "FAILED");
    assert.equal(mismatch.failureCode, "BOND_AMOUNT_MISMATCH");
  });

  it("5. valid close full refund", async () => {
    const opened = await openAndVerify();
    const close = await bondAdapter.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence: makeEvidence({
        outcome: "valid_close",
        policyHash: opened.policyHash,
        penaltyAtomic: "0",
        refundAtomic: BOND.toString(),
        nonce: `rh-close-${opened.sessionId}`,
      }),
    });
    assert.equal(close.status, "CONFIRMED");
    assert.equal(close.bondRefundedAtomic, BOND.toString());
    assert.equal(close.penaltyAtomic, "0");
  });

  it("6. expiry settlement boundedness — penalty > max 사전 거부", async () => {
    const opened = await openAndVerify();
    const over = await bondAdapter.requestExpiredReservationSettlement({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      penaltyAtomic: (MAX_PENALTY + 1n).toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
      bondAmountAtomic: BOND.toString(),
      reservationId: "rh-resv-over",
    });
    assert.equal(over.status, "FAILED");
    assert.equal(over.failureCode, "PENALTY_EXCEEDS_MAX");
  });

  it("7. bond conservation — refunded + penalty == bond", async () => {
    const opened = await openAndVerify();
    const penalty = 300_000n;
    const settle = await bondAdapter.requestExpiredReservationSettlement({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      penaltyAtomic: penalty.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
      bondAmountAtomic: BOND.toString(),
      reservationId: "rh-resv-1",
      evidence: makeEvidence({
        outcome: "expired_reservation",
        policyHash: opened.policyHash,
        penaltyAtomic: penalty.toString(),
        refundAtomic: (BOND - penalty).toString(),
        nonce: `rh-exp-${opened.sessionId}`,
        reservationId: "rh-resv-1",
      }),
    });
    assert.equal(settle.status, "CONFIRMED");
    assert.equal(
      BigInt(settle.bondRefundedAtomic!) + BigInt(settle.penaltyAtomic!),
      BOND,
      "보존식 refunded + penalty == bondAmount"
    );
  });

  it("8. transaction status envelope — CONFIRMED tx 폴링 + 미지 서명 PENDING", async () => {
    const opened = await openAndVerify();
    const close = await bondAdapter.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence: makeEvidence({
        outcome: "valid_close",
        policyHash: opened.policyHash,
        penaltyAtomic: "0",
        refundAtomic: BOND.toString(),
        nonce: `rh-close2-${opened.sessionId}`,
      }),
    });
    // 정산 직후엔 processed 단계일 수 있음 — PENDING은 retryable이므로 계약대로 폴링
    let st = await bondAdapter.getTransactionStatus({ providerReference: close.providerReference! });
    for (let i = 0; i < 20 && st.status === "PENDING"; i++) {
      assert.isTrue(st.retryable, "PENDING은 retryable이어야 폴링 가능");
      await new Promise((r) => setTimeout(r, 500));
      st = await bondAdapter.getTransactionStatus({ providerReference: close.providerReference! });
    }
    assertStableEnvelope(st, "tx status");
    assert.equal(st.status, "CONFIRMED");

    const unknown = await bondAdapter.getTransactionStatus({
      providerReference: "1".repeat(87), // 형식상 유효하나 존재하지 않는 서명
    });
    assertStableEnvelope(unknown, "unknown tx");
    assert.equal(unknown.status, "PENDING");
    assert.isTrue(unknown.retryable);
  });
});
