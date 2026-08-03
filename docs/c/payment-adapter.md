# PaymentAdapter 구현 노트 — fallback 모드 (docs/09 delivery #1·#2·#4)

구현: `packages/payment-client/src/payment-adapter.ts` (`CappedSessionPaymentAdapter`).
계약 미러: `packages/payment-client/src/contracts-mirror.ts` — PaymentChallengeResult/PaymentVerificationResult/UsageSettlementResult 필드는 docs/09 envelope + activation 규칙 + docs/03 receipt 명명(`usageChargedAtomic`) 기준. 병합 시 B 실타입과 대조.

## 모드 판정 (delivery #1 — 피치 문구)

spike 판정(`docs/c/paysh-spike.md` 2026-08-02): **fallback 확정.**

- pay.sh가 실제 제공(검증됨): per-call x402 결제 rail — sandbox에서 402 → 지불 → 응답 실동작.
- pay.sh가 제공 표면 확인(E2E 미검증): MPP subscription delegation (per-period 금액 상한, Plan PDA 필요).
- 세션 usage cap 집행: **Gateway 사전검사 + PaymentAdapter bounded settlement** (pay.sh 기능이라고 주장하지 않음).
- Solana bond는 reservation 같은 bonded action의 객관적 expiry만 담보한다. read-only session cap을 담보한다고 표현하지 않는다.
- 피치 문구: "pay.sh x402는 per-call 결제 rail이며, 세션 사용 상한은 BotBond Gateway가 결정적으로 집행합니다. Solana bond는 예약 같은 bonded action만 담보합니다."

데모 흐름에서 이 어댑터의 위치: agent가 pay.sh(sandbox) 402 결제 완료 → 결제 authority가 `issueCredential(sessionId, usageLimitAtomic)`로 불투명 credential 발급 → agent가 gateway에 제시 → `verifyCredential`이 CONFIRMED + `usageLimitAtomic` 반환 → gateway activation 규칙(`usageLimitAtomic >= usageCapAtomic`) 판정. 이 bridge는 live pay.sh verification이 아니므로 Gateway가 결과에 `FAKE_ADAPTER_FIXTURE`를 덧붙인다.

## 안정 실패코드 표 (변경은 CCR)

| failureCode | retryable | 의미 |
|---|---|---|
| `AMOUNT_INVALID` | false | atomic decimal string 아님 (float·음수·선행 0) |
| `CHALLENGE_INVALID` | false | challenge 서명·세션 바인딩 불일치 |
| `CREDENTIAL_INVALID` | false | credential 서명 위조·형식 오류·한도가 challenge cap 미달 |
| `CREDENTIAL_SESSION_MISMATCH` | false | 타 세션용 credential 제시 |
| `USAGE_INPUT_INVALID` | false | calls가 음수·비정수 |

전 코드 non-retryable — 전송 계층이 없어 네트워크성 실패가 없다 (pay.sh 실연동으로 확장 시 `NETWORK_UNAVAILABLE`(retryable) 추가 예정).

## 의미론

- challenge/credential = `base64url(JSON payload) + "." + HMAC-SHA256 hex` (로컬 슬라이스 공유키, 프로덕션은 KMS — B 계약과 동일 구도). 검증은 `timingSafeEqual`.
- credential 불투명성(docs/09 규칙 4): 어떤 결과·에러에도 원문 미포함, 로그 금지. 테스트로 강제.
- `createChallenge`는 세션 단위 idempotent (재요청 시 동일 challenge).
- `getUsageSettlement` = `calls × unitPriceAtomic`(기본 1000 — docs/03 receipt 예시 20 calls→"20000" 정합), cap 상한. B 하니스 체크 "usage settlement bounded by cap" 대응.

## 검증 상태

- `tests/payment-adapter.test.ts` 8 passing (체인 불필요 단독 실행 가능). 전체 스위트 25 passing.
- 미검증(Limit): B `runPaymentAdapterContract` 하니스는 병합 후. pay.sh 실연동(402 endpoint를 gateway 뒤에 배치)은 데모 범위 밖 — sandbox rail 시연과 어댑터는 issueCredential로 연결.
