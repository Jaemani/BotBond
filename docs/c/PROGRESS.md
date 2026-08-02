# 역할 C 진행 로그 — Payment Protocol & Solana

형식: 팀 플랜(docs/05-team-plan.md)의 발표 근거 규칙을 따른다. 매 작업 단위마다 한 블록.

```text
Claim: 우리가 증명한 것
Evidence: URL / tx / test / screenshot
Limit: 아직 증명하지 않은 것
```

---

## 2026-08-02

Claim: 저장소 스캐폴딩 완료, 팀 문서 docs/ 이관, 역할 C 작업 환경 셋업 시작.
Evidence: 이 저장소 구조 (README 권장 구조 그대로), docs/00~06.
Limit: Rust/Anchor 툴체인 설치 중. CLI 키페어 devnet SOL 미확보(airdrop 레이트리밋, Phantom→CLI 이체 대기). 온체인 트랜잭션 아직 0건.

Claim: 해커톤 공식 심사기준·마감 확인 — 제출 마감 8/3 (월) 23:59 KST, 온체인 실행 증빙 필수.
Evidence: gcp-solana-ai-agentic-hacks-kr.xyz 랜딩 페이지 원문 (심사기준 4: 혁신성/UX · AI 활용도 · 기술완성도/블록체인 연동 · 실제 구동 여부).
Limit: 제출 양식 세부(소개서 템플릿 등)는 디스코드/참가 안내 미확인.

Claim: botbond 프로그램(open_bond/close_valid/settle_violation/reclaim_expired) 구현·빌드 완료, docs/03 §7 계약 불변식 9케이스 로컬 검증 통과.
Evidence: `tests/botbond.test.ts` 9 passing (solana-test-validator, program ID `HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc`) — escrow 이동·max_penalty<=bond·과거 expiry 거부·비권한 정산 거부·전액 환불·이중정산 거부·제한 정산+잔액 환불·penalty<=max·grace 전 reclaim 차단/후 허용.
Limit: devnet 미배포 (CLI 키페어 0 SOL — airdrop 레이트리밋 지속, Phantom→`BCvDRgFChtunjJ2mnGnBF9HGRvZm2wTSPgNWJxvCg6Hb` 이체 대기). 온체인 public 증빙 아직 0건.

Claim: B의 docs/09 BondAdapter 계약 실구현(SolanaBondAdapter) — stable envelope, atomic string 금액, evidence hash/nonce 바인딩·HMAC 검증·replay 거부, session/reservation 단위 idempotency, 보존식 `refunded+penalty==bond`, FAKE 마커 없음.
Evidence: `packages/payment-client/src/bond-adapter.ts` + `tests/bond-adapter.test.ts` 8 passing. 실패코드·재시도·finality 규칙은 `docs/c/bond-adapter.md` (delivery #3·#4·#5 대응).
Limit: B의 `runBondAdapterContract` 하니스는 B 저장소에만 있어 병합 후 실행 필요. golden policy Rust 패리티는 fixture 실물(`packages/contracts/fixtures/golden-policy.json`) 필요. PaymentAdapter(pay.sh)는 spike 미착수 — 전 항목 NOT VERIFIED 유지.

Claim: 팀 정합 문서(_docs 07~10) 저장소 편입, CCR 번호 충돌 해소(내 session_nonce 제안을 CCR-002로 재번호 — CCR-001은 B가 2026-08-02 선점).
Evidence: `docs/07~10-*.md`, `docs/ccr/CCR-002.md`.
Limit: CCR-002는 여전히 Proposed — 팀 승인 대기.

Claim: pay.sh spike 완료 — sandbox에서 402 per-call 결제 rail 실검증(설치·ephemeral wallet·402→지불→응답 수신), MPP subscription delegation은 CLI 표면 확인(per-period 금액 상한 + `--network sandbox`). 판정: 세션 cap 집행은 gateway+bond fallback 확정, pay.sh는 per-call rail로만 주장.
Evidence: `docs/c/paysh-spike.md` VERIFIED 표 + 조사 로그 1~3 (pay v0.26.0, debugger.pay.sh AAPL quote 수신).
Limit: verifyCredential·getUsageSettlement의 pay.sh 서버측 표면 미확인(로컬 슬라이스는 HMAC fallback). subscription E2E는 provider측 Plan PDA 필요로 데모 범위 밖. devnet 실결제 미실행.

Claim: docs/09 PaymentAdapter 실구현(CappedSessionPaymentAdapter, fallback 모드) — challenge/credential HMAC 발급·검증, credential 불투명성, activation 규칙(usageLimitAtomic), 정확 과금 + cap 상한 정산. 전체 스위트 25 passing.
Evidence: `packages/payment-client/src/payment-adapter.ts` + `tests/payment-adapter.test.ts` 8 passing. 모드 판정·실패코드는 `docs/c/payment-adapter.md`.
Limit: B `runPaymentAdapterContract` 하니스는 병합 후. pay.sh 실연동(402 endpoint를 gateway 뒤 배치)은 데모 범위 밖 — sandbox rail 시연과 issueCredential 브리지로 연결.

Claim: devnet 증빙 원샷 파이프라인 준비 완료 — 배포 + open→close(전액환불) + replay 거부 + open→penalty 정산을 한 명령으로 실행, tx·Explorer 링크를 `docs/c/solana-evidence.md`에 자동 기록.
Evidence: `scripts/devnet-evidence.sh`, `scripts/devnet-scenario.ts` (로컬 validator 스모크 통과).
Limit: devnet 실행 자체는 CLI 키페어 SOL 부족으로 대기 — Phantom→`BCvDRgFChtunjJ2mnGnBF9HGRvZm2wTSPgNWJxvCg6Hb` 5 SOL 이체 후 `bash scripts/devnet-evidence.sh` 1회.

Claim: **devnet 온체인 증빙 확보 완료** (제출 필수 항목 #8·#9) — 프로그램 배포 + open_bond×2 / close_valid(전액환불) / settle_violation(penalty 300000, 잔액 700000 환불, 보존식 성립) 실행, 같은 세션 재정산 시도는 `SETTLEMENT_CONFLICT`로 거부(이중정산 방어). close/settle tx는 `Finalized` 확인.
Evidence: `docs/c/solana-evidence.md` — Program `HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc`(devnet, slot 480678232 배포), tx 4건 Explorer 링크. 재현: `bash scripts/devnet-evidence.sh`.
Limit: agent 서명은 데모상 CLI 키페어(=payer)가 대행 — Phantom 지갑이 직접 서명하는 데모영상용 흐름은 A의 UI 경유(별도). 반복 실행 시 devnet RPC 429 레이트리밋으로 재시도 지연 가능.

Claim: **병합 리허설 완료** (B 지시 "지금 B랑 합칠 수 있도록 + 실제로 될지 미리 테스트") — B 하니스 8체크(docs/09)를 같은 명칭·순서로 레플리카해 8/8 통과, canonical policy hash 구현(docs/03 §1), payment-client를 npm workspace 패키지화(`@botbond/payment-client`), B용 배선 가이드 작성. 전체 스위트 37 passing (프로그램 9 + bond 8 + payment 8 + policy-hash 4 + 리허설 8).
Evidence: `tests/adapter-contract-rehearsal.test.ts`, `tests/policy-hash.test.ts`, `packages/payment-client/src/policy-hash.ts`, `packages/payment-client/package.json`, `docs/c/merge-plan.md`. 실측 특이사항: 정산 직후 `getTransactionStatus`는 1~2초 PENDING(retryable) — gateway 폴링 필요(merge-plan §4에 명기).
Limit: B 저장소 실물 필요분만 잔여 — 실제 `runBondAdapterContract`/`runPaymentAdapterContract` 실행(delivery #7), golden fixture 패리티(GOLDEN 블록 주석 해제, 기대 `sha256:120cece7…`), contracts-mirror↔실타입 필드명 diff. HMAC 공유키 2종(BOTBOND_EVIDENCE_SECRET·BOTBOND_PAYMENT_SECRET) 값은 팀 채널 합의 필요.
