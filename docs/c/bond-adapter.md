# BondAdapter 구현 노트 — 실패코드·재시도·finality (docs/09 delivery #4·#5·#6)

구현: `packages/payment-client/src/bond-adapter.ts` (`SolanaBondAdapter`).
계약 타입 미러: `packages/payment-client/src/contracts-mirror.ts` — 저장소 병합 시 `@botbond/contracts` import로 교체.
실어댑터 규칙 준수: `FAKE_ADAPTER_FIXTURE` 마커 없음, provider SDK 객체는 어댑터 경계를 넘지 않음, 금액은 전부 atomic decimal string.

## 안정 실패코드 표 (변경은 CCR)

| failureCode | retryable | 의미 | 발생 지점 |
|---|---|---|---|
| `BOND_NOT_FOUND` | false | bond account 미존재 / sessionId 미등록 | verify·settle 전 조회 |
| `BOND_NOT_OPEN` | false | 세션이 OPEN이 아님 (verify 시) | verifyOpenBond |
| `BOND_POLICY_MISMATCH` | false | 온체인 policy_hash ≠ 요청 policyHash | verifyOpenBond |
| `BOND_AMOUNT_MISMATCH` | false | bond/max_penalty 금액 불일치 | verify·settle |
| `PENALTY_EXCEEDS_MAX` | false | `penalty <= maxPenalty <= bondAmount` 위반 | 어댑터 사전검사 + 온체인 |
| `EVIDENCE_INVALID` | false | evidence hash 형식·요청 바인딩·HMAC 서명 불일치 | 체인 제출 전 |
| `EVIDENCE_REPLAY` | false | nonce 재사용 | 체인 제출 전 |
| `SETTLEMENT_CONFLICT` | false | 이미 다른 outcome/receipt로 정산됨 (이중정산 차단) | 온체인 status 게이트 |
| `NETWORK_UNAVAILABLE` | true | RPC 오류·타임아웃·blockhash 만료 | 전송 계층 |
| `TX_FAILED` | false | 그 외 온체인 프로그램 오류 | 트랜잭션 실행 |

재시도 규칙: `retryable: true`인 코드만 동일 입력으로 재호출한다. 정산 재호출은 session/reservation identity 기준 idempotent — 같은 입력이면 같은 결과(같은 `providerReference`)가 돌아온다. 어댑터 캐시 유실(재시작) 후에도 온체인 `receipt_hash` 대조로 idempotent 성공을 복원한다.

## Evidence 바인딩 (체인 경계)

- `receipt_hash`(온체인 32B) = evidence의 canonical sha256 hash. 정산 트랜잭션에 영구 기록되어 receipt 회수 근거가 된다.
- 어댑터는 제출 전에 검증: hash 형식(64 hex), outcome·policyHash·penaltyAtomic·reservationId가 요청과 일치, nonce 미사용(replay 거부), HMAC-SHA256 서명(`secret`, `"{hash}.{nonce}"`) — 로컬 슬라이스. 프로덕션 서명자는 Secret Manager/KMS (B 계약 그대로).
- replay 최종 방어선은 온체인 status 게이트(OPEN에서만 정산 가능) — 프로세스 상태와 무관하게 이중정산 불가.

## Finality / confirmation 규칙

- `CONFIRMED` = 트랜잭션이 `confirmed` 또는 `finalized` commitment 도달 (`getSignatureStatuses`). devnet 데모 기준 `confirmed`로 충분, 제출 증빙 링크는 finalized 후 캡처 권장.
- `PENDING` = 서명은 존재하나 아직 `processed` 이하이거나 RPC가 서명을 못 찾는 상태 (`retryable: true`, 같은 `providerReference`로 폴링).
- `FAILED` + `TX_FAILED` = 온체인 `err` 확정. 성공 receipt 생성 금지 (B 규칙 "Non-confirmed settlement cannot produce success receipt").

## Reference 형식 (delivery #6)

- Program ID: `HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc` (devnet 배포 후 solana-evidence.md에서 최종 확정)
- Network: Solana devnet / IDL: `target/idl/botbond.json` (빌드 산출물, 저장소 포함 예정)
- `providerReference`: 정산류 = base58 tx signature (폴링·receipt 회수용 안정 키), verify = bond account 주소
- Explorer URL 파생은 UI 몫이 아니라 C가 제공: `explorerTxUrl(sig)` → `https://explorer.solana.com/tx/<SIG>?cluster=devnet`. Gateway는 안정 reference만 저장.

## 검증 상태

- 로컬 검증: `tests/bond-adapter.test.ts` 8케이스 (envelope·보존식 `refunded+penalty==bond`·idempotency·replay/서명 거부·경계 사전검사·캐시 유실 복원·이중정산 conflict·status 폴링) + `tests/botbond.test.ts` 9케이스 전부 통과 (local validator).
- 미검증(Limit): B의 `runBondAdapterContract` 하니스 실행은 저장소 병합 후 (하니스 코드는 B 저장소에만 존재). golden policy Rust 패리티도 fixture 실물 필요.
