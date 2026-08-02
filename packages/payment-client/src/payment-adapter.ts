/**
 * CappedSessionPaymentAdapter — docs/09 PaymentAdapter 계약 구현.
 *
 * spike 판정(docs/c/paysh-spike.md 2026-08-02)에 따른 fallback 모드:
 * 세션 usage cap 집행은 pay.sh가 아니라 gateway(사전검사) + bond(위반 정산)가 담당하고,
 * 이 어댑터는 challenge/credential 발급·검증과 usage 정산 계산(cap 상한)을 제공한다.
 * pay.sh는 per-call 402 rail로만 데모(sandbox 검증 완료) — 결제 성공 후 issueCredential이 브리지.
 *
 * FAKE_ADAPTER_FIXTURE 마커 없음(테스트 픽스처가 아니라 로컬 슬라이스 실동작 구현).
 * credential은 불투명 유지 — 어떤 결과/에러에도 원문을 되돌려주거나 로그하지 않는다.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type {
  AdapterResult,
  PaymentAdapter,
  PaymentChallengeResult,
  PaymentVerificationResult,
  UsageSettlementResult,
} from "@botbond/contracts";

/** 안정 실패코드 표 (payment 계열) — 변경은 CCR. */
export const PAYMENT_FAILURE_CODES = {
  AMOUNT_INVALID: { retryable: false },
  CHALLENGE_INVALID: { retryable: false },
  CREDENTIAL_INVALID: { retryable: false },
  CREDENTIAL_SESSION_MISMATCH: { retryable: false },
  USAGE_INPUT_INVALID: { retryable: false },
} as const;

export type PaymentFailureCode = keyof typeof PAYMENT_FAILURE_CODES;

function fail(code: PaymentFailureCode): AdapterResult {
  return { status: "FAILED", retryable: PAYMENT_FAILURE_CODES[code].retryable, failureCode: code };
}

/** atomic decimal string (음수·소수·지수·선행 0 금지) */
function isAtomic(s: unknown): s is string {
  return typeof s === "string" && /^(0|[1-9][0-9]*)$/.test(s);
}

type SignedPayload = {
  v: 1;
  kind: "botbond-payment-challenge" | "botbond-payment-credential";
  sessionId: string;
  amountAtomic: string; // challenge=usageCapAtomic, credential=usageLimitAtomic
  nonce: string;
};

export class CappedSessionPaymentAdapter implements PaymentAdapter {
  private readonly secret: string;
  private readonly unitPriceAtomic: bigint;
  /** sessionId → challenge 결과 (idempotent 재발급) */
  private readonly challenges = new Map<string, PaymentChallengeResult>();

  constructor(opts: {
    /** 로컬 슬라이스 공유 HMAC 키 (프로덕션은 KMS 서명자로 교체 — B 계약과 동일 구도) */
    hmacSecret: string;
    /** per-call 단가. docs/03 receipt 예시(20 calls → "20000") 기준 기본 1000 */
    unitPriceAtomic?: string;
  }) {
    this.secret = opts.hmacSecret;
    const unit = opts.unitPriceAtomic ?? "1000";
    if (!isAtomic(unit)) throw new Error("unitPriceAtomic must be an atomic decimal string");
    this.unitPriceAtomic = BigInt(unit);
  }

  async createChallenge(input: {
    sessionId: string;
    usageCapAtomic: string;
  }): Promise<PaymentChallengeResult> {
    if (!isAtomic(input.usageCapAtomic)) return fail("AMOUNT_INVALID");

    const cached = this.challenges.get(input.sessionId);
    if (cached) return cached;

    const token = this.sign({
      v: 1,
      kind: "botbond-payment-challenge",
      sessionId: input.sessionId,
      amountAtomic: input.usageCapAtomic,
      nonce: randomBytes(16).toString("hex"),
    });
    const result: PaymentChallengeResult = {
      status: "CONFIRMED",
      retryable: false,
      providerReference: `challenge:${input.sessionId}`,
      challenge: token,
    };
    this.challenges.set(input.sessionId, result);
    return result;
  }

  /**
   * 결제 완료 브리지: 데모에서 agent가 pay.sh(sandbox) 402 결제를 마친 뒤,
   * 결제 authority(=gateway 측 이 어댑터)가 usage 한도를 담은 credential을 발급한다.
   * 반환값은 불투명 토큰 — 호출측은 내용 파싱·로그 금지.
   */
  issueCredential(sessionId: string, usageLimitAtomic: string): string {
    if (!isAtomic(usageLimitAtomic)) throw new Error("usageLimitAtomic must be atomic");
    return this.sign({
      v: 1,
      kind: "botbond-payment-credential",
      sessionId,
      amountAtomic: usageLimitAtomic,
      nonce: randomBytes(16).toString("hex"),
    });
  }

  async verifyCredential(input: {
    sessionId: string;
    credential: string;
    challenge?: string;
  }): Promise<PaymentVerificationResult> {
    const cred = this.verifyToken(input.credential, "botbond-payment-credential");
    if (!cred) return fail("CREDENTIAL_INVALID");
    if (cred.sessionId !== input.sessionId) return fail("CREDENTIAL_SESSION_MISMATCH");
    if (!isAtomic(cred.amountAtomic)) return fail("CREDENTIAL_INVALID");

    if (input.challenge !== undefined) {
      const ch = this.verifyToken(input.challenge, "botbond-payment-challenge");
      if (!ch || ch.sessionId !== input.sessionId) return fail("CHALLENGE_INVALID");
      // challenge가 요구한 cap을 credential 한도가 커버해야 activation 가능
      if (BigInt(cred.amountAtomic) < BigInt(ch.amountAtomic)) return fail("CREDENTIAL_INVALID");
    }

    return {
      status: "CONFIRMED",
      retryable: false,
      providerReference: `credential:${input.sessionId}`,
      usageLimitAtomic: cred.amountAtomic,
    };
  }

  async getUsageSettlement(input: {
    sessionId: string;
    calls: number;
    usageCapAtomic: string;
  }): Promise<UsageSettlementResult> {
    if (!Number.isInteger(input.calls) || input.calls < 0) return fail("USAGE_INPUT_INVALID");
    if (!isAtomic(input.usageCapAtomic)) return fail("AMOUNT_INVALID");

    const cap = BigInt(input.usageCapAtomic);
    const exact = BigInt(input.calls) * this.unitPriceAtomic;
    const charged = exact > cap ? cap : exact; // cap 상한 (B 하니스: usage settlement bounded by cap)
    return {
      status: "CONFIRMED",
      retryable: false,
      providerReference: `usage:${input.sessionId}:${input.calls}`,
      usageChargedAtomic: charged.toString(),
    };
  }

  // --- 내부 ---

  private sign(payload: SignedPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", this.secret).update(body).digest("hex");
    return `${body}.${sig}`;
  }

  private verifyToken(token: string, kind: SignedPayload["kind"]): SignedPayload | null {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const given = token.slice(dot + 1);
    const expected = createHmac("sha256", this.secret).update(body).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = /^[0-9a-fA-F]+$/.test(given) ? Buffer.from(given, "hex") : Buffer.alloc(0);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SignedPayload;
      if (payload.v !== 1 || payload.kind !== kind) return null;
      if (typeof payload.sessionId !== "string" || typeof payload.nonce !== "string") return null;
      return payload;
    } catch {
      return null;
    }
  }
}
