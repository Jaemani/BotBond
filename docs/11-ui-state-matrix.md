# UI State Matrix

역할 A 산출물. `docs/03-contracts.md`의 `BotBondEvent`만을 입력으로 삼는다.
프론트엔드는 허용·차단을 스스로 판단하지 않는다. 이 표에 없는 판정 로직을
`apps/web`에 추가하면 계약 위반이다.

## 1. 패널 구조

```text
┌──────────────┬─────────────────────────┬──────────────────────┐
│ 01 INTENT    │ 02 CONTRACT             │ 03 MONEY             │
│ 자연어 목적   │ 서명된 최소권한 계약서   │ usage / bond / tx    │
├──────────────┴─────────────────────────┴──────────────────────┤
│ 04 DECISION TRACE — 모든 판정과 그 근거                        │
├───────────────────────────────────────────────────────────────┤
│ RECEIPT — outcome / usage / penalty / refund / receiptHash    │
└───────────────────────────────────────────────────────────────┘
```

번호 01–04는 장식이 아니다. Intent → Contract → Access → Settlement는 실제
순서이고, 심사위원이 따라가야 하는 경로다.

## 2. 이벤트 → 화면 반영

| 이벤트 | 01 Intent | 02 Contract | 03 Money | 04 Trace |
|---|---|---|---|---|
| `REQUEST_DENIED` (`phase: PRE_SESSION`) | — | — | — | `NO SESSION` 행, 403 |
| `INTENT_RECEIVED` | 자연어 인용 + 예산 | — | cap 값 초기화 | — |
| `POLICY_COMPILED` | state → `POLICY_READY` | manifest 렌더, 제외 항목 취소선, 해시 인장 | usage cap / bond / ceiling 확정 | — |
| `PAYMENT_VERIFIED` | state → `PAYMENT_READY` | — | usage 블록 활성 | — |
| `BOND_OPENED` | state → `BONDED` | — | vault `HELD`, tx `Bond locked` | — |
| `SESSION_ACTIVATED` | state → `ACTIVE` | — | — | — |
| `REQUEST_ALLOWED` | 호출 카운터 +1 | — | usage 게이지 증가 | `ALLOWED` 행 + 반환 필드 |
| `REQUEST_DENIED` (`IN_SESSION`) | denied 카운터 +1 | — | **vault 미동, `bond ±0` 배너 노출** | `DENIED` 행 + 사유 |
| `RESERVATION_CREATED` | — | — | 예약 카드 + TTL 게이지 | `HELD` 행 |
| `RESERVATION_CREATED` (`tick: true`) | — | — | TTL 게이지만 감소 | — |
| `RESERVATION_RELEASED` / `_CONSUMED` | — | — | 예약 상태 전환, vault 미동 | `RELEASED` / `PURCHASED` |
| `RESERVATION_EXPIRED` | — | — | 예약 `EXPIRED`, vault → `SETTLING` | `EXPIRED` 행 |
| `USAGE_SETTLED` | — | — | usage 확정 | `USAGE SETTLED` |
| `PENALTY_SETTLED` | — | — | vault에서 penalty 조각 분리(적색) | `BOUNDED SETTLEMENT` |
| `BOND_REFUNDED` | — | — | vault → `RETURNED` | `BOND RETURNED` |
| `SESSION_CLOSED` | state → `CLOSED`/`VIOLATED` | — | — | Receipt 노출 |

## 3. 필수 7개 상태

역할 A 시작 프롬프트의 요구사항과 대응 화면.

| # | 요구 상태 | 재현 방법 | 확인 포인트 |
|---|---|---|---|
| 1 | 미등록 에이전트 403 + 공식 경로 발견 | 임의 시나리오 0번째 이벤트 | `NO SESSION` 행, discovery 힌트 |
| 2 | 자연어와 컴파일된 정책 나란히 | 시나리오 1, cursor 3 | 01과 02 패널 동시 표시 |
| 3 | usage와 bond 시각적 분리 | 시나리오 1, cursor 5+ | 색·모양·축이 모두 다름 |
| 4 | 정상 조회 → 예약 → 해제 → bond 반환 | 시나리오 1 전체 | vault `RETURNED`, penalty 0 |
| 5 | 범위 밖 차단, 무차감 | 시나리오 2 | `bond ±0` 배너, receipt penalty 0 |
| 6 | 예약 방치 → 제한 정산 + 잔액 반환 | 시나리오 3 | vault 조각 분리, ceiling 표기 |
| 7 | pending / confirmed / failed | tx 상태값 | `tx-status` 3색 |

7번은 fixture에 현재 `CONFIRMED`만 있다. `PENDING`과 `FAILED`는 C가 실제
transaction 결과 모델을 확정한 뒤 fixture에 추가한다. 그때까지 스타일만 준비.

## 4. 절대 규칙

1. **fake transaction을 live처럼 보여주지 않는다.** 우측 상단 `DEV FIXTURE`
   배지는 실제 SSE 연결 전까지 제거 금지.
2. **차단은 차감이 아니다.** `REQUEST_DENIED`가 오면 bond 게이지는 어떤
   애니메이션도 하지 않는다. 움직이지 않는 것 자체가 연출이다.
3. **usage와 bond는 서로 다른 물체다.** usage는 가로로 소진되는 막대(앰버),
   bond는 잠겼다 돌아오는 블록(시안). 같은 모양으로 만들지 않는다.
4. **판정은 게이트웨이가 한다.** 프론트에 `if (path === "/seller-contacts")`
   같은 코드를 쓰지 않는다.

## 5. B 연동 결정 (2026-08-03)

- SSE는 shared envelope와 문서화된 terminal ordering을 따른다.
- `phase`는 shared contract가 아니다. Gateway가 생략하면 프론트는 session lifecycle로
  pre-session / in-session을 표시한다.
- `usageSpentAtomic` 누적값은 Gateway 보장 필드가 아니다. 프론트는
  `REQUEST_ALLOWED.chargedAtomic`을 합산하고 terminal `USAGE_SETTLED`를 최종값으로 쓴다.
- TTL tick 이벤트는 live SSE에 없다. 프론트는 `expiresAt`과 현재 시각으로 남은 시간을
  계산하며, 기존 fixture의 synthetic tick은 무시한다.

## 6. C에게 요청하는 것

- `transaction` 객체 형태 확정: `{ signature, status, cluster, slot }`
- Explorer URL 형식: `https://explorer.solana.com/tx/{sig}?cluster=devnet`
- `PENDING → CONFIRMED` 전이 시 같은 signature로 이벤트를 두 번 보내는지,
  아니면 상태만 갱신하는지
- 실패 시 `FAILED` 이벤트의 사유 필드명
