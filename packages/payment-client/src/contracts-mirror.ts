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
