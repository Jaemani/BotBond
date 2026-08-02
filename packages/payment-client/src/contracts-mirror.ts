/**
 * docs/09-role-c-integration-handoff.md의 B측 계약 타입 구조적 미러.
 * 저장소 병합 후에는 이 파일을 지우고 `@botbond/contracts`에서 import한다.
 * (여기 필드를 바꾸면 안 됨 — 바꾸려면 CCR)
 */

export type AdapterStatus = "PENDING" | "CONFIRMED" | "FAILED";

export type AdapterResult = {
  status: AdapterStatus;
  retryable: boolean;
  providerReference?: string;
  failureCode?: string;
};

/** 금액은 전부 atomic decimal string. float 금지. */
export type BondVerificationResult = AdapterResult & {
  bondAccount?: string;
  bondAmountAtomic?: string;
  maxPenaltyAtomic?: string;
  policyHash?: string;
};

export type BondSettlementResult = AdapterResult & {
  penaltyAtomic?: string;
  bondRefundedAtomic?: string;
};

/**
 * Gateway가 생성·서명하는 정산 승인 증거 (로컬 슬라이스=HMAC, 프로덕션=KMS).
 * Role C는 체인 경계에서 hash/nonce를 바인딩·검증하고 replay를 거부한다.
 */
export type SettlementAuthorizationEvidence = {
  evidenceHash: string; // sha256 hex (canonical evidence payload)
  authority: string;
  nonce: string;
  issuedAt: string; // ISO8601
  outcome: "valid_close" | "expired_reservation";
  policyHash: string;
  penaltyAtomic: string;
  refundAtomic: string;
  usageAtomic?: string;
  reservationId?: string;
  signature?: string; // HMAC-SHA256(secret, `${evidenceHash}.${nonce}`) hex
};

/**
 * PaymentAdapter 결과 타입 — docs/09는 envelope + activation 규칙(`usageLimitAtomic` 필수)만
 * 명시하므로 필드는 최소로 유지. 명명은 docs/03 receipt(`usageChargedAtomic`) 정합.
 * 병합 시 B의 `@botbond/contracts` 실타입과 대조 후 교체.
 */
export type PaymentChallengeResult = AdapterResult & {
  /** agent에게 전달할 불투명 challenge (서명 포함). 로그 금지 대상 아님(credential만 금지)이나 관례상 축약 로그 권장. */
  challenge?: string;
  usageCapAtomic?: string;
};

export type PaymentVerificationResult = AdapterResult & {
  /** Gateway activation 규칙: CONFIRMED + usageLimitAtomic >= AccessPolicy.constraints.usageCapAtomic */
  usageLimitAtomic?: string;
};

export type UsageSettlementResult = AdapterResult & {
  /** docs/03 receipt 필드명 정합 (calls × unit price, cap 상한) */
  usageChargedAtomic?: string;
};

export interface PaymentAdapter {
  createChallenge(input: {
    sessionId: string;
    usageCapAtomic: string;
  }): Promise<PaymentChallengeResult>;

  verifyCredential(input: {
    sessionId: string;
    credential: string;
    challenge?: string;
  }): Promise<PaymentVerificationResult>;

  getUsageSettlement(input: {
    sessionId: string;
    calls: number;
    usageCapAtomic: string;
  }): Promise<UsageSettlementResult>;
}

export interface BondAdapter {
  verifyOpenBond(input: {
    sessionId: string;
    bondAccount: string;
    policyHash: string;
    amountAtomic: string;
    maxPenaltyAtomic: string;
  }): Promise<BondVerificationResult>;

  requestValidClose(input: {
    sessionId: string;
    policyHash: string;
    amountAtomic: string;
    evidence?: SettlementAuthorizationEvidence;
  }): Promise<BondSettlementResult>;

  requestExpiredReservationSettlement(input: {
    sessionId: string;
    policyHash: string;
    penaltyAtomic: string;
    maxPenaltyAtomic: string;
    bondAmountAtomic: string;
    reservationId: string;
    evidence?: SettlementAuthorizationEvidence;
  }): Promise<BondSettlementResult>;

  getTransactionStatus(input: {
    providerReference: string;
  }): Promise<AdapterResult>;
}
