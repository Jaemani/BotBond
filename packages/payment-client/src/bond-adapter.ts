/**
 * SolanaBondAdapter — docs/09 BondAdapter 계약의 실구현 (fake 아님, FAKE_ADAPTER_FIXTURE 마커 없음).
 * 경계 규칙: 입출력은 전부 plain 값. anchor/web3 객체는 이 파일 밖으로 내보내지 않는다.
 */
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { PublicKey, Signer } from "@solana/web3.js";
import { BotBondClient, BondSessionView } from "./index";
import {
  AdapterResult,
  BondAdapter,
  BondSettlementResult,
  BondVerificationResult,
  SettlementAuthorizationEvidence,
} from "./contracts-mirror";

/** 안정 실패코드 표 — docs/c/bond-adapter.md와 함께 유지 (변경은 CCR). */
export const FAILURE_CODES = {
  BOND_NOT_FOUND: { retryable: false },
  BOND_NOT_OPEN: { retryable: false },
  BOND_POLICY_MISMATCH: { retryable: false },
  BOND_AMOUNT_MISMATCH: { retryable: false },
  PENALTY_EXCEEDS_MAX: { retryable: false },
  EVIDENCE_INVALID: { retryable: false },
  EVIDENCE_REPLAY: { retryable: false },
  SETTLEMENT_CONFLICT: { retryable: false },
  NETWORK_UNAVAILABLE: { retryable: true },
  TX_FAILED: { retryable: false },
} as const;

export type FailureCode = keyof typeof FAILURE_CODES;

function fail(code: FailureCode): AdapterResult {
  return { status: "FAILED", retryable: FAILURE_CODES[code].retryable, failureCode: code };
}

/** "sha256:<hex>" 접두 유무를 흡수해 소문자 hex 64자로 정규화. 형식이 아니면 null. */
export function normalizeHashHex(input: string): string | null {
  const hex = input.startsWith("sha256:") ? input.slice(7) : input;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? hex.toLowerCase() : null;
}

export function canonicalReceiptHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export class SolanaBondAdapter implements BondAdapter {
  private readonly client: BotBondClient;
  private readonly settlementAuthority: Signer;
  private readonly hmacSecret?: string;
  /** sessionId → 온체인 bond account. verifyOpenBond에서만 등록된다. */
  private readonly sessions = new Map<string, PublicKey>();
  /** 정산 idempotency 캐시: close:{sessionId} / expiry:{sessionId}:{reservationId} */
  private readonly settledResults = new Map<string, BondSettlementResult>();
  private readonly seenNonces = new Set<string>();

  constructor(opts: {
    client: BotBondClient;
    settlementAuthority: Signer;
    /** 로컬 슬라이스 HMAC 공유키. 미설정이면 evidence 서명 검증은 생략(해시·nonce 검증은 유지). */
    evidenceHmacSecret?: string;
  }) {
    this.client = opts.client;
    this.settlementAuthority = opts.settlementAuthority;
    this.hmacSecret = opts.evidenceHmacSecret;
  }

  async verifyOpenBond(input: {
    sessionId: string;
    bondAccount: string;
    policyHash: string;
    amountAtomic: string;
    maxPenaltyAtomic: string;
  }): Promise<BondVerificationResult> {
    const policyHex = normalizeHashHex(input.policyHash);
    if (!policyHex) return fail("BOND_POLICY_MISMATCH");

    let view: BondSessionView;
    try {
      view = await this.client.fetchBondSession(new PublicKey(input.bondAccount));
    } catch (e) {
      return this.classifyFetchError(e);
    }

    if (view.status !== "OPEN") return fail("BOND_NOT_OPEN");
    if (view.policyHashHex !== policyHex) return fail("BOND_POLICY_MISMATCH");
    if (
      view.bondAmountAtomic !== input.amountAtomic ||
      view.maxPenaltyAtomic !== input.maxPenaltyAtomic
    ) {
      return fail("BOND_AMOUNT_MISMATCH");
    }

    this.sessions.set(input.sessionId, new PublicKey(input.bondAccount));
    return {
      status: "CONFIRMED",
      retryable: false,
      providerReference: input.bondAccount,
      bondAccount: input.bondAccount,
      bondAmountAtomic: view.bondAmountAtomic,
      maxPenaltyAtomic: view.maxPenaltyAtomic,
      policyHash: `sha256:${view.policyHashHex}`,
    };
  }

  async requestValidClose(input: {
    sessionId: string;
    policyHash: string;
    amountAtomic: string;
    evidence?: SettlementAuthorizationEvidence;
  }): Promise<BondSettlementResult> {
    const idemKey = `close:${input.sessionId}`;
    const cached = this.settledResults.get(idemKey);
    if (cached) return cached;

    const session = this.sessions.get(input.sessionId);
    if (!session) return fail("BOND_NOT_FOUND");

    const evidenceCheck = this.checkEvidence(input.evidence, {
      outcome: "valid_close",
      policyHash: input.policyHash,
      penaltyAtomic: "0",
    });
    if ("failureCode" in evidenceCheck) return evidenceCheck;

    const receiptHash = evidenceCheck.receiptHash ?? this.fallbackReceiptHash({
      sessionId: input.sessionId,
      outcome: "valid_close",
      policyHash: input.policyHash,
      penaltyAtomic: "0",
    });

    let view: BondSessionView;
    try {
      view = await this.client.fetchBondSession(session);
    } catch (e) {
      return this.classifyFetchError(e);
    }
    if (view.status === "CLOSED") {
      // 재시작 후 재호출 등 — 온체인 receipt와 대조해 idempotent 성공으로 회복
      if (view.receiptHashHex === receiptHash) {
        return this.recoverSettled(idemKey, session, "0", view.bondAmountAtomic);
      }
      return fail("SETTLEMENT_CONFLICT");
    }
    if (view.status !== "OPEN") return fail("SETTLEMENT_CONFLICT");
    if (view.bondAmountAtomic !== input.amountAtomic) return fail("BOND_AMOUNT_MISMATCH");

    try {
      const res = await this.client.closeValid({
        settlementAuthority: this.settlementAuthority,
        session,
        receiptHash: Buffer.from(receiptHash, "hex"),
      });
      const result: BondSettlementResult = {
        status: "CONFIRMED",
        retryable: false,
        providerReference: res.signature,
        penaltyAtomic: "0",
        bondRefundedAtomic: view.bondAmountAtomic,
      };
      this.settledResults.set(idemKey, result);
      if (input.evidence?.nonce) this.seenNonces.add(input.evidence.nonce);
      return result;
    } catch (e) {
      return this.classifyTxError(e);
    }
  }

  async requestExpiredReservationSettlement(input: {
    sessionId: string;
    policyHash: string;
    penaltyAtomic: string;
    maxPenaltyAtomic: string;
    bondAmountAtomic: string;
    reservationId: string;
    evidence?: SettlementAuthorizationEvidence;
  }): Promise<BondSettlementResult> {
    const idemKey = `expiry:${input.sessionId}:${input.reservationId}`;
    const cached = this.settledResults.get(idemKey);
    if (cached) return cached;

    const session = this.sessions.get(input.sessionId);
    if (!session) return fail("BOND_NOT_FOUND");

    const penalty = BigInt(input.penaltyAtomic);
    const maxPenalty = BigInt(input.maxPenaltyAtomic);
    const bondAmount = BigInt(input.bondAmountAtomic);
    if (!(penalty <= maxPenalty && maxPenalty <= bondAmount)) {
      return fail("PENALTY_EXCEEDS_MAX");
    }

    const evidenceCheck = this.checkEvidence(input.evidence, {
      outcome: "expired_reservation",
      policyHash: input.policyHash,
      penaltyAtomic: input.penaltyAtomic,
      reservationId: input.reservationId,
    });
    if ("failureCode" in evidenceCheck) return evidenceCheck;

    const receiptHash = evidenceCheck.receiptHash ?? this.fallbackReceiptHash({
      sessionId: input.sessionId,
      outcome: "expired_reservation",
      policyHash: input.policyHash,
      penaltyAtomic: input.penaltyAtomic,
      reservationId: input.reservationId,
    });

    let view: BondSessionView;
    try {
      view = await this.client.fetchBondSession(session);
    } catch (e) {
      return this.classifyFetchError(e);
    }
    if (view.status === "VIOLATED") {
      if (view.receiptHashHex === receiptHash && view.settledPenaltyAtomic === input.penaltyAtomic) {
        const refunded = (bondAmount - penalty).toString();
        return this.recoverSettled(idemKey, session, input.penaltyAtomic, refunded);
      }
      return fail("SETTLEMENT_CONFLICT");
    }
    if (view.status !== "OPEN") return fail("SETTLEMENT_CONFLICT");
    if (view.bondAmountAtomic !== input.bondAmountAtomic) return fail("BOND_AMOUNT_MISMATCH");

    try {
      const res = await this.client.settleViolation({
        settlementAuthority: this.settlementAuthority,
        session,
        receiptHash: Buffer.from(receiptHash, "hex"),
        penaltyAtomic: penalty,
      });
      const result: BondSettlementResult = {
        status: "CONFIRMED",
        retryable: false,
        providerReference: res.signature,
        penaltyAtomic: penalty.toString(),
        bondRefundedAtomic: (bondAmount - penalty).toString(),
      };
      this.settledResults.set(idemKey, result);
      if (input.evidence?.nonce) this.seenNonces.add(input.evidence.nonce);
      return result;
    } catch (e) {
      return this.classifyTxError(e);
    }
  }

  async getTransactionStatus(input: { providerReference: string }): Promise<AdapterResult> {
    try {
      const conn = this.client.program.provider.connection;
      const res = await conn.getSignatureStatuses([input.providerReference], {
        searchTransactionHistory: true,
      });
      const st = res.value[0];
      if (!st) {
        return { status: "PENDING", retryable: true, providerReference: input.providerReference };
      }
      if (st.err) {
        return {
          status: "FAILED",
          retryable: false,
          providerReference: input.providerReference,
          failureCode: "TX_FAILED",
        };
      }
      const confirmed =
        st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized";
      return {
        status: confirmed ? "CONFIRMED" : "PENDING",
        retryable: !confirmed,
        providerReference: input.providerReference,
      };
    } catch {
      return {
        status: "PENDING",
        retryable: true,
        providerReference: input.providerReference,
        failureCode: "NETWORK_UNAVAILABLE",
      };
    }
  }

  // --- 내부 ---

  /** evidence의 hash 형식·요청 바인딩·nonce replay·(가능하면) HMAC 서명을 검증. */
  private checkEvidence(
    evidence: SettlementAuthorizationEvidence | undefined,
    expect: { outcome: string; policyHash: string; penaltyAtomic: string; reservationId?: string }
  ): AdapterResult | { receiptHash?: string } {
    if (!evidence) return {};
    const hashHex = normalizeHashHex(evidence.evidenceHash);
    if (!hashHex) return fail("EVIDENCE_INVALID");
    if (evidence.outcome !== expect.outcome) return fail("EVIDENCE_INVALID");
    if (normalizeHashHex(evidence.policyHash) !== normalizeHashHex(expect.policyHash)) {
      return fail("EVIDENCE_INVALID");
    }
    if (evidence.penaltyAtomic !== expect.penaltyAtomic) return fail("EVIDENCE_INVALID");
    if (expect.reservationId && evidence.reservationId !== expect.reservationId) {
      return fail("EVIDENCE_INVALID");
    }
    if (this.seenNonces.has(evidence.nonce)) return fail("EVIDENCE_REPLAY");
    if (this.hmacSecret) {
      const expected = createHmac("sha256", this.hmacSecret)
        .update(`${hashHex}.${evidence.nonce}`)
        .digest("hex");
      const given = evidence.signature ?? "";
      const a = Buffer.from(expected, "hex");
      const b = /^[0-9a-fA-F]+$/.test(given) ? Buffer.from(given, "hex") : Buffer.alloc(0);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("EVIDENCE_INVALID");
    }
    return { receiptHash: hashHex };
  }

  private fallbackReceiptHash(payload: Record<string, unknown>): string {
    return canonicalReceiptHash(payload);
  }

  /** 캐시 유실(재시작) 후 이미 정산된 세션의 idempotent 성공 응답 복원. */
  private async recoverSettled(
    idemKey: string,
    session: PublicKey,
    penaltyAtomic: string,
    refundedAtomic: string
  ): Promise<BondSettlementResult> {
    let reference: string | undefined;
    try {
      const conn = this.client.program.provider.connection;
      const sigs = await conn.getSignaturesForAddress(session, { limit: 1 });
      reference = sigs[0]?.signature;
    } catch {
      reference = undefined;
    }
    const result: BondSettlementResult = {
      status: "CONFIRMED",
      retryable: false,
      providerReference: reference,
      penaltyAtomic,
      bondRefundedAtomic: refundedAtomic,
    };
    this.settledResults.set(idemKey, result);
    return result;
  }

  private classifyFetchError(e: unknown): AdapterResult {
    const msg = `${e}`;
    if (/Account does not exist|could not find account|Invalid public key/i.test(msg)) {
      return fail("BOND_NOT_FOUND");
    }
    return fail("NETWORK_UNAVAILABLE");
  }

  private classifyTxError(e: unknown): AdapterResult {
    const msg = `${e}`;
    if (/AlreadySettled/.test(msg)) return fail("SETTLEMENT_CONFLICT");
    if (/PenaltyExceedsMax/.test(msg)) return fail("PENALTY_EXCEEDS_MAX");
    if (/Unauthorized/.test(msg)) return fail("TX_FAILED");
    if (/blockhash|timeout|ECONNREFUSED|fetch failed|429/i.test(msg)) {
      return fail("NETWORK_UNAVAILABLE");
    }
    return fail("TX_FAILED");
  }
}
