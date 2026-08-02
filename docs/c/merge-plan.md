# 병합 가이드 (C → B 저장소) — 리허설 결과 포함

작성: 2026-08-02, 역할 C. 대상 독자: B (gateway 소유자).
목적: docs/07~10 안내서대로 C 산출물을 B 저장소에 넣을 때 필요한 배선을 한 번에 끝내기 위한 체크리스트.
리허설: 아래 배선을 가정한 레플리카 테스트가 C 저장소에서 전부 통과함 (하단 "리허설 결과").

## 1. 가져갈 파일 (C 소유 경계 그대로)

| C 저장소 경로 | B 저장소 배치 | 비고 |
|---|---|---|
| `programs/botbond/**` | `programs/botbond/` | Anchor 프로그램 (devnet 배포 완료, ID `HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc`) |
| `target/idl/botbond.json` | 동일 경로 또는 `packages/payment-client/idl/` | 빌드 산출물. anchor build로 재생성 가능 |
| `packages/payment-client/**` | `packages/payment-client/` | package.json 포함 (`@botbond/payment-client`, npm workspace 호환) |
| `tests/*.test.ts` | `tests/` 또는 B 컨벤션 위치 | botbond(9)·bond-adapter(8)·payment-adapter(8)·policy-hash(4)·adapter-contract-rehearsal(8) |
| `scripts/**` | `scripts/` | devnet 증빙 원샷 파이프라인 |
| `docs/c/**` | `docs/c/` | 증빙·진행 문서 (solana-evidence.md가 데모영상 재료) |
| `Anchor.toml` | 루트 병합 | cluster/wallet 설정만 충돌 가능 — B 루트에 맞춰 조정 |

`docs/00~06`, `docs/07~10`은 팀 공용이므로 B 저장소 버전이 기준 (C 쪽 사본은 버림).

## 2. contracts-mirror → @botbond/contracts 교체

`packages/payment-client/src/contracts-mirror.ts`는 B의 `@botbond/contracts` 타입을 임시 미러한 것.

1. `contracts-mirror.ts`의 타입(AdapterResult, BondAdapter, PaymentAdapter, *Result, SettlementAuthorizationEvidence)과 B 실물 타입 diff 확인 — 필드명 불일치는 CCR 없이 C가 B 쪽에 맞춤.
2. `src/index.ts`·`src/bond-adapter.ts`·`src/payment-adapter.ts`의 `./contracts-mirror` import를 `@botbond/contracts`로 교체.
3. `contracts-mirror.ts` 삭제.

## 3. 어댑터 생성자 배선 (gateway 측)

docs/08의 placeholder `"paymentCredential":"fake-payment-ok"` / `"bondAccount":"fake-bond-ok"` 를 만드는 지점이 교체 대상. 실어댑터는 FAKE 마커 없음.

```ts
import * as anchor from "@coral-xyz/anchor";
import {
  BotBondClient, SolanaBondAdapter, CappedSessionPaymentAdapter,
} from "@botbond/payment-client";

const provider = anchor.AnchorProvider.env(); // ANCHOR_PROVIDER_URL + ANCHOR_WALLET
anchor.setProvider(provider);
const program = anchor.workspace.botbond;     // 또는 new anchor.Program(idl, provider)
const client = new BotBondClient(program, "devnet"); // cluster는 Explorer 링크 파생용

const bondAdapter = new SolanaBondAdapter({
  client,
  settlementAuthority,            // gateway 정산 키페어 (Signer)
  evidenceHmacSecret: process.env.BOTBOND_EVIDENCE_SECRET,
});
const paymentAdapter = new CappedSessionPaymentAdapter({
  hmacSecret: process.env.BOTBOND_PAYMENT_SECRET,
  unitPriceAtomic: "1000",        // docs/03 예시 단가. 정책별로 다르면 세션 생성 시 주입
});
```

필요 env (로컬 슬라이스):

| env | 용도 | 비고 |
|---|---|---|
| `ANCHOR_PROVIDER_URL` | RPC (`http://127.0.0.1:8899` 또는 devnet) | |
| `ANCHOR_WALLET` | gateway 수수료 지불 키페어 경로 | |
| `BOTBOND_EVIDENCE_SECRET` | settlement evidence HMAC 공유키 | **값은 팀 채널로 합의** (저장소 커밋 금지) |
| `BOTBOND_PAYMENT_SECRET` | payment challenge/credential HMAC 키 | 동일 |

## 4. 흐름별 호출 순서 (gateway가 부를 것)

- 세션 활성화: `paymentAdapter.createChallenge` → (pay.sh 402 결제) → `paymentAdapter.issueCredential(sessionId, usageLimitAtomic)` → `paymentAdapter.verifyCredential` — activation 규칙 `CONFIRMED && usageLimitAtomic >= usageCapAtomic`. 동시에 `client.openBond`(agent 서명) 후 `bondAdapter.verifyOpenBond`.
- 정상 종료: `paymentAdapter.getUsageSettlement` + `bondAdapter.requestValidClose(evidence)` — full refund.
- reservation expiry: `bondAdapter.requestExpiredReservationSettlement(evidence)` — `refunded + penalty == bond` 보존.
- 폴링: `bondAdapter.getTransactionStatus(providerReference)` — **정산 직후 1~2초는 PENDING(retryable)일 수 있음. PENDING이면 재조회** (리허설 실측).
- evidence 생성 규칙(HMAC 대상 문자열, canonical hash)은 `docs/c/bond-adapter.md` §Evidence 바인딩.

## 5. golden fixture 패리티 (병합 직후 1분 작업)

`tests/policy-hash.test.ts` 하단 GOLDEN 블록 주석 해제 →
`packages/contracts/fixtures/golden-policy.json` 대비 `canonicalPolicyHash` == `sha256:120cece73bb7e5229db531c96d82b9d210a419ac9a901a34ccf72b136d346feb` 확인.
불일치 시 canonicalization 규칙(키 정렬·공백·undefined 처리) diff를 C가 수정.

## 6. 병합 후 검증 (delivery #7)

1. `npm install` (workspace에 `@botbond/payment-client` 포함 확인)
2. local validator + `anchor deploy` (또는 devnet 그대로)
3. B 하니스: `runBondAdapterContract(bondAdapter)` / `runPaymentAdapterContract(paymentAdapter)` — 8체크
4. `npm run e2e`
5. C 테스트 스위트 회귀 (37케이스)

## 리허설 결과 (2026-08-02, C 저장소)

- B 하니스 8체크를 같은 명칭·순서로 레플리카한 `tests/adapter-contract-rehearsal.test.ts` **8/8 통과** (local validator): stable status envelope / payment cap coverage / usage settlement bounded by cap / bond amount and max penalty match policy / valid close full refund / expiry settlement boundedness / bond conservation / transaction status envelope.
- 전체 스위트 37케이스 통과 (프로그램 9 + bond 어댑터 8 + payment 어댑터 8 + policy-hash 4 + 리허설 8).
- 남은 미검증 = B 저장소 실물이 필요한 것뿐: 실제 하니스 실행, golden fixture 패리티, 타입 필드명 diff.
