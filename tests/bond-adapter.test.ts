/**
 * SolanaBondAdapter 통합 테스트 — docs/09 계약 (stable envelope, 보존식,
 * idempotency, evidence hash/nonce 바인딩·replay 거부)을 실 프로그램 위에서 검증.
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { createHmac } from "crypto";
import { assert } from "chai";
import {
  BotBondClient,
  SolanaBondAdapter,
  SettlementAuthorizationEvidence,
  canonicalReceiptHash,
} from "../packages/payment-client/src";

const HMAC_SECRET = "local-slice-shared-secret";
const BOND = 1_000_000n;
const MAX_PENALTY = 500_000n;

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
  const signature = createHmac("sha256", HMAC_SECRET)
    .update(`${evidenceHash}.${args.nonce}`)
    .digest("hex");
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
    signature,
  };
}

describe("SolanaBondAdapter (docs/09 BondAdapter contract)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.botbond as anchor.Program;
  const client = new BotBondClient(program, "custom");

  const payer = (provider.wallet as anchor.Wallet).payer;
  const agent = payer;
  const merchant = Keypair.generate();
  const authority = Keypair.generate();

  const adapter = new SolanaBondAdapter({
    client,
    settlementAuthority: authority,
    evidenceHmacSecret: HMAC_SECRET,
  });

  let mint: PublicKey;
  let nonceCounter = 1000n;

  async function openOnChain(): Promise<{ sessionId: string; bondAccount: string; policyHash: string }> {
    const policyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) policyBytes[i] = Math.floor(Math.random() * 256);
    const nonce = nonceCounter++;
    const res = await client.openBond({
      agent,
      merchant: merchant.publicKey,
      settlementAuthority: authority.publicKey,
      mint,
      policyHash: policyBytes,
      sessionNonce: nonce,
      bondAmountAtomic: BOND,
      maxPenaltyAtomic: MAX_PENALTY,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    return {
      sessionId: `sess-${nonce}`,
      bondAccount: res.session,
      policyHash: `sha256:${Buffer.from(policyBytes).toString("hex")}`,
    };
  }

  async function openAndVerify() {
    const opened = await openOnChain();
    const v = await adapter.verifyOpenBond({
      sessionId: opened.sessionId,
      bondAccount: opened.bondAccount,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    assert.equal(v.status, "CONFIRMED");
    return opened;
  }

  before(async () => {
    mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    const agentAta = await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, mint, agent.publicKey
    );
    await mintTo(provider.connection, payer, mint, agentAta.address, payer, 100_000_000n);
    await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, mint, merchant.publicKey
    );
  });

  it("verifyOpenBond confirms a matching on-chain bond", async () => {
    const opened = await openOnChain();
    const v = await adapter.verifyOpenBond({
      sessionId: opened.sessionId,
      bondAccount: opened.bondAccount,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    assert.equal(v.status, "CONFIRMED");
    assert.equal(v.retryable, false);
    assert.equal(v.bondAmountAtomic, BOND.toString());
    assert.equal(v.maxPenaltyAtomic, MAX_PENALTY.toString());
    assert.equal(v.providerReference, opened.bondAccount);
  });

  it("verifyOpenBond fails on amount/policy mismatch (policy-bond binding)", async () => {
    const opened = await openOnChain();
    const wrongAmount = await adapter.verifyOpenBond({
      sessionId: `${opened.sessionId}-wrong`,
      bondAccount: opened.bondAccount,
      policyHash: opened.policyHash,
      amountAtomic: (BOND + 1n).toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    assert.equal(wrongAmount.status, "FAILED");
    assert.equal(wrongAmount.failureCode, "BOND_AMOUNT_MISMATCH");

    const wrongPolicy = await adapter.verifyOpenBond({
      sessionId: `${opened.sessionId}-wrong2`,
      bondAccount: opened.bondAccount,
      policyHash: `sha256:${"ab".repeat(32)}`,
      amountAtomic: BOND.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    assert.equal(wrongPolicy.status, "FAILED");
    assert.equal(wrongPolicy.failureCode, "BOND_POLICY_MISMATCH");
  });

  it("requestValidClose refunds fully, binds evidence hash on-chain, and is idempotent", async () => {
    const opened = await openAndVerify();
    const evidence = makeEvidence({
      outcome: "valid_close",
      policyHash: opened.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: `nonce-${opened.sessionId}`,
    });

    const r1 = await adapter.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence,
    });
    assert.equal(r1.status, "CONFIRMED");
    assert.equal(r1.penaltyAtomic, "0");
    assert.equal(r1.bondRefundedAtomic, BOND.toString());
    assert.isString(r1.providerReference);
    // 보존식: refunded + penalty == bondAmount
    assert.equal(
      BigInt(r1.bondRefundedAtomic!) + BigInt(r1.penaltyAtomic!),
      BOND
    );
    // 체인에 evidence hash가 receipt로 바인딩됐는지
    const view = await client.fetchBondSession(new PublicKey(opened.bondAccount));
    assert.equal(view.receiptHashHex, evidence.evidenceHash);

    // 같은 요청 재호출 → 같은 결과 (idempotency)
    const r2 = await adapter.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence,
    });
    assert.equal(r2.providerReference, r1.providerReference);
  });

  it("rejects evidence with a reused nonce (replay) and a bad signature", async () => {
    const a = await openAndVerify();
    const evA = makeEvidence({
      outcome: "valid_close",
      policyHash: a.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: "shared-nonce-1",
    });
    const ok = await adapter.requestValidClose({
      sessionId: a.sessionId,
      policyHash: a.policyHash,
      amountAtomic: BOND.toString(),
      evidence: evA,
    });
    assert.equal(ok.status, "CONFIRMED");

    // 다른 세션에서 같은 nonce 재사용 → replay 거부
    const b = await openAndVerify();
    const evB = makeEvidence({
      outcome: "valid_close",
      policyHash: b.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: "shared-nonce-1",
    });
    const replay = await adapter.requestValidClose({
      sessionId: b.sessionId,
      policyHash: b.policyHash,
      amountAtomic: BOND.toString(),
      evidence: evB,
    });
    assert.equal(replay.status, "FAILED");
    assert.equal(replay.failureCode, "EVIDENCE_REPLAY");

    // 서명 위조 → EVIDENCE_INVALID
    const evBad = makeEvidence({
      outcome: "valid_close",
      policyHash: b.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: "fresh-nonce-2",
    });
    evBad.signature = "00".repeat(32);
    const bad = await adapter.requestValidClose({
      sessionId: b.sessionId,
      policyHash: b.policyHash,
      amountAtomic: BOND.toString(),
      evidence: evBad,
    });
    assert.equal(bad.status, "FAILED");
    assert.equal(bad.failureCode, "EVIDENCE_INVALID");
  });

  it("expired reservation settlement is bounded, conserves the bond, and is idempotent per reservation", async () => {
    const opened = await openAndVerify();
    const penalty = 300_000n;
    const evidence = makeEvidence({
      outcome: "expired_reservation",
      policyHash: opened.policyHash,
      penaltyAtomic: penalty.toString(),
      refundAtomic: (BOND - penalty).toString(),
      nonce: `nonce-exp-${opened.sessionId}`,
      reservationId: "resv-1",
    });

    const r1 = await adapter.requestExpiredReservationSettlement({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      penaltyAtomic: penalty.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
      bondAmountAtomic: BOND.toString(),
      reservationId: "resv-1",
      evidence,
    });
    assert.equal(r1.status, "CONFIRMED");
    assert.equal(r1.penaltyAtomic, penalty.toString());
    assert.equal(
      BigInt(r1.bondRefundedAtomic!) + BigInt(r1.penaltyAtomic!),
      BOND,
      "bondRefundedAtomic + penaltyAtomic == bondAmountAtomic"
    );

    const r2 = await adapter.requestExpiredReservationSettlement({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      penaltyAtomic: penalty.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
      bondAmountAtomic: BOND.toString(),
      reservationId: "resv-1",
      evidence,
    });
    assert.equal(r2.providerReference, r1.providerReference, "idempotent by reservation identity");
  });

  it("rejects penalty above max before touching the chain", async () => {
    const opened = await openAndVerify();
    const r = await adapter.requestExpiredReservationSettlement({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      penaltyAtomic: (MAX_PENALTY + 1n).toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
      bondAmountAtomic: BOND.toString(),
      reservationId: "resv-over",
    });
    assert.equal(r.status, "FAILED");
    assert.equal(r.failureCode, "PENALTY_EXCEEDS_MAX");
  });

  it("recovers idempotently after cache loss, and conflicts on mismatched receipt", async () => {
    const opened = await openAndVerify();
    const evidence = makeEvidence({
      outcome: "valid_close",
      policyHash: opened.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: `nonce-recover-${opened.sessionId}`,
    });
    const first = await adapter.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence,
    });
    assert.equal(first.status, "CONFIRMED");

    // 프로세스 재시작 시뮬레이션: 캐시 없는 새 어댑터
    const fresh = new SolanaBondAdapter({
      client,
      settlementAuthority: authority,
      evidenceHmacSecret: HMAC_SECRET,
    });
    const v = await fresh.verifyOpenBond({
      sessionId: opened.sessionId,
      bondAccount: opened.bondAccount,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      maxPenaltyAtomic: MAX_PENALTY.toString(),
    });
    // 이미 닫힌 세션이므로 verify는 BOND_NOT_OPEN — 등록만 수동으로 대체
    assert.equal(v.failureCode, "BOND_NOT_OPEN");
    (fresh as any).sessions.set(opened.sessionId, new PublicKey(opened.bondAccount));

    const recovered = await fresh.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence,
    });
    assert.equal(recovered.status, "CONFIRMED", "same evidence → idempotent success");

    const conflicting = new SolanaBondAdapter({
      client,
      settlementAuthority: authority,
      evidenceHmacSecret: HMAC_SECRET,
    });
    (conflicting as any).sessions.set(opened.sessionId, new PublicKey(opened.bondAccount));
    const other = makeEvidence({
      outcome: "valid_close",
      policyHash: opened.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: `nonce-conflict-${opened.sessionId}`,
    });
    const conflict = await conflicting.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence: other,
    });
    assert.equal(conflict.status, "FAILED");
    assert.equal(conflict.failureCode, "SETTLEMENT_CONFLICT", "double settlement rejected");
  });

  it("getTransactionStatus returns the stable envelope", async () => {
    const opened = await openAndVerify();
    const evidence = makeEvidence({
      outcome: "valid_close",
      policyHash: opened.policyHash,
      penaltyAtomic: "0",
      refundAtomic: BOND.toString(),
      nonce: `nonce-status-${opened.sessionId}`,
    });
    const closed = await adapter.requestValidClose({
      sessionId: opened.sessionId,
      policyHash: opened.policyHash,
      amountAtomic: BOND.toString(),
      evidence,
    });
    const st = await adapter.getTransactionStatus({
      providerReference: closed.providerReference!,
    });
    assert.oneOf(st.status, ["CONFIRMED", "PENDING"]);
    if (st.status === "CONFIRMED") assert.equal(st.retryable, false);

    const unknown = await adapter.getTransactionStatus({
      providerReference:
        "1111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
    });
    assert.equal(unknown.status, "PENDING");
    assert.equal(unknown.retryable, true);
  });
});
