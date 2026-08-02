# pay.sh Capability Spike — VERIFIED / NOT VERIFIED

원칙(docs/06 역할 C 프롬프트): pay.sh가 실제로 검증되지 않은 동작을 pay.sh 이름으로 에뮬레이션하지 않는다. 검증 안 되면 fallback(고정 charge + gateway 측 cap)으로 가고 피치 문구를 수정한다.

## Capability 표

| Capability | 상태 | 증거 | 비고 |
|---|---|---|---|
| SDK 설치·초기화 | NOT VERIFIED | | |
| 단일 endpoint 결제 challenge (createChallenge) | NOT VERIFIED | | |
| credential 검증 (verifyCredential) | NOT VERIFIED | | |
| MPP capped repeated-call session | NOT VERIFIED | | 핵심 리스크 — 불가 시 fallback |
| usage 정산 조회 (getUsageSettlement) | NOT VERIFIED | | |
| 실제 결제 1건 (Gate 1 요건) | NOT VERIFIED | | |

## Gateway adapter 인터페이스 (B 핸드오프)

```ts
interface PaymentAdapter {
  createChallenge(req: { sessionId: string; amountAtomic: string }): Promise<PaymentChallenge>;
  verifyCredential(credential: string): Promise<{ valid: boolean; capAtomic: string }>;
  getUsageSettlement(sessionId: string): Promise<{ chargedAtomic: string; receiptRef: string }>;
}
```

(타입 세부는 spike 결과에 따라 CCR로 확정)

## 조사 로그

- (기록 시작 전)
