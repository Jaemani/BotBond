# pay.sh Capability Spike — VERIFIED / NOT VERIFIED

원칙(docs/06 역할 C 프롬프트): pay.sh가 실제로 검증되지 않은 동작을 pay.sh 이름으로 에뮬레이션하지 않는다. 검증 안 되면 fallback(고정 charge + gateway 측 cap)으로 가고 피치 문구를 수정한다.

## Capability 표

| Capability | 상태 | 증거 | 비고 |
|---|---|---|---|
| SDK 설치·초기화 | **VERIFIED (sandbox)** | `npx -y @solana/pay` → pay v0.26.0 설치·실행, `--sandbox`가 ephemeral wallet 자동 생성 (2026-08-02 조사 로그 #1) | 실자금 불요 |
| BotBond 유료 endpoint x402 호출 | **VERIFIED (sandbox)** | BotBond Pay Gate `:1403` → Gateway `:18080`, `GET /v1/access/{sessionId}/products`가 402 결제 후 실제 상품 JSON 200 응답 (조사 로그 #4) | pay.sh가 `Authorization`을 소유하므로 BotBond scope token은 `x-botbond-session-token`으로 분리 |
| 단일 외부 endpoint 결제 challenge | **VERIFIED (sandbox)** | `pay --sandbox curl https://debugger.pay.sh/mpp/quote/AAPL` → 402 challenge를 CLI가 투명 처리 후 응답 수신 (조사 로그 #2) | x402 rail 독립 검증 |
| credential 검증 (verifyCredential) | NOT VERIFIED | | pay.sh 서버측 검증 표면 미확인 → 로컬 슬라이스는 fallback (HMAC 서명 credential) |
| MPP capped repeated-call session | **부분 VERIFIED (표면)** | `pay subscriptions` = "MPP subscription-intent delegations". `new --plan <Plan PDA> --amount <per-period, base units> --period <30d>` — per-period 금액 상한 delegation 실재, `--network sandbox` 지원 (조사 로그 #3) | E2E 미검증: 활성화에 provider측 on-chain Plan PDA 필요 — debugger 데모엔 없음. **판정: cap 집행은 gateway+bond 측(fallback), pay.sh는 per-call 402 rail로만 주장** |
| usage 정산 조회 (getUsageSettlement) | NOT VERIFIED | | pay.sh 정산 조회 API 미확인 → gateway 측 call count × unit price 계산(fallback) |
| 실제 결제 1건 (Gate 1 요건) | **VERIFIED (sandbox)** | 조사 로그 #2의 402 → 지불 → `{"symbol":"AAPL","price":"254.49",...}` 수신. sandbox=localnet 실서명 트랜잭션 | devnet/실자금 아님 — 피치 문구는 "sandbox 검증" 명시 |

## Gateway adapter 인터페이스 (B 핸드오프 — docs/09 기준으로 확정)

docs/09-role-c-integration-handoff.md §PaymentAdapter가 유일 기준. 이전 초안(입력 형태 상이)은 폐기.

```ts
interface PaymentAdapter {
  createChallenge(input: { sessionId: string; usageCapAtomic: string }): Promise<PaymentChallengeResult>;
  verifyCredential(input: { sessionId: string; credential: string; challenge?: string }): Promise<PaymentVerificationResult>;
  getUsageSettlement(input: { sessionId: string; calls: number; usageCapAtomic: string }): Promise<UsageSettlementResult>;
}
```

Gateway 활성화 규칙: `status == CONFIRMED` + `usageLimitAtomic >= AccessPolicy.constraints.usageCapAtomic`. credential은 불투명 유지, 로그 금지.

## 판정 (2026-08-02)

docs/06 원칙대로 **fallback 확정**: 세션 usage cap 집행은 pay.sh가 아니라 Gateway 사전검사와 PaymentAdapter bounded settlement가 담당한다. Solana bond는 reservation 같은 bonded action의 객관적 expiry만 담보한다. pay.sh는 (a) per-call 402 결제 rail — sandbox 실검증 완료, (b) MPP subscription delegation — 표면 확인, E2E는 Plan PDA(provider측) 필요로 데모 범위 밖. 피치 문구: "pay.sh x402는 per-call 결제 rail이며, 세션 사용 상한은 BotBond Gateway가 결정적으로 집행합니다. Solana bond는 예약 같은 bonded action만 담보합니다."

## 조사 로그

1. **2026-08-02 sandbox 설치·wallet**: `npx -y @solana/pay --sandbox curl https://debugger.pay.sh/mpp/quote/AAPL` 1회 실행으로 pay v0.26.0 자동 설치 + ephemeral wallet 생성(localnet, `EHzX5ENq15cuDk1Ev1YNhT35ChHtw6hNhVtscuPeh1dk`). 실자금 접점 없음.
2. **2026-08-02 402 흐름**: 같은 명령에서 서버 402 Payment Required → CLI가 sandbox 지갑으로 지불 → 재요청 → `{"symbol":"AAPL","price":"254.49","currency":"USD","source":"mpp-demo"}` 수신. x402 per-call 결제 rail 실동작 확인.
3. **2026-08-02 subscriptions 표면**: `pay subscriptions --help` / `new --help` — subcommand list/status/new/cancel/refresh. `new`는 on-chain `Plan` PDA(base58, spec의 `externalId`) + `--mint` + `--puller`(plan.owner 또는 plan.pullers 소속) + `--recipient`(plan.destinations 인가) + `--amount`(per-period, mint base units decimal string) + `--period`(`30d`/`2w`, `month`는 프로필상 거부) 요구. `--network`에 `sandbox` slug 존재. `pay --sandbox subscriptions list` 정상 동작(빈 목록). → per-period 금액 상한 delegation은 실재하나, 활성화엔 provider가 만든 Plan PDA가 선행 — 우리 데모 범위에서 E2E 불가 판정.
4. **2026-08-03 BotBond Pay Gate 통합**: `infra/paywall.yml`의 `x402-exact` 규칙으로 sandbox Pay Gate를 `127.0.0.1:1403`에 실행하고 Gateway를 `127.0.0.1:18080`에 연결했다. `pay --sandbox curl`이 402를 처리한 뒤 BotBond 세션의 scoped product endpoint에서 상품 2건 JSON을 200으로 수신했다. Gateway는 bearer와 `x-botbond-session-token`을 모두 검증하며, 결제 middleware와 scope credential이 같은 `Authorization` 헤더를 놓고 충돌하지 않는다. 이 검증은 per-call rail 증거이며 세션 활성화용 HMAC bridge를 live pay.sh verifier로 바꾸지는 않는다.
