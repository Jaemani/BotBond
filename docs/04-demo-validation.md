# Demo and Validation Plan

## 1. 3분 데모 스토리

### 0:00–0:20 — 문제

화면에 미등록 구매 에이전트와 보호 API를 보여준다.

```text
GET /products → 403 UNKNOWN AUTOMATED CLIENT
```

멘트:

> 사이트는 모르는 봇을 막아야 합니다. 문제는 오늘 만들어진 정상 에이전트도 똑같이 막힌다는 겁니다.

### 0:20–0:45 — 해결 정의

에이전트가 `/.well-known/agent-access`를 발견한다.

> BotBond는 신원을 아는 척하지 않습니다. 대신 무엇을 할지 제한하고, 그 약속에 환불 가능한 담보를 붙입니다.

### 0:45–1:20 — Intent에서 계약으로

입력:

> 등록된 노트북의 가격과 재고를 비교하고, 가장 좋은 상품 하나를 60초만 예약해줘. 판매자 연락처는 필요 없어.

화면에서 Gemini가 다음을 생성한다.

- 실제 demo catalog의 `/products`, `/products/{id}/inventory`만 허용
- `/reservations`는 최대 1회, 60초만 허용
- `price`, `stock`, `shipping`만 허용
- 최대 5회, 5분
- usage cap 0.20 USDC
- refundable bond 1.00 USDC

정책 해시를 표시한다.

### 1:20–1:45 — 실제 돈의 상태 변화

- pay.sh 결제/session credential 확인
- Solana devnet `open_bond` transaction
- Explorer 링크
- `Usage 0 / 0.20`과 `Bond 1.00 locked`를 별도 표시

### 1:45–2:15 — 정상 에이전트

실제 catalog의 두 SKU를 조회하고 상품 하나를 예약한다. 에이전트가 선택을 마친 뒤 예약을 해제하고 세션을 닫는다.

```text
Usage settled: 0.003 USDC
Bond refunded: 1.00 USDC
```

반환 transaction을 표시한다.

### 2:15–2:45 — 반전

두 번째 에이전트가 같은 정책으로 `/seller-contacts`를 요청한다.

```text
REQUEST DENIED
Reason: path outside signed policy
Protected data exposed: 0
Bond penalty: 0
```

그다음 허용된 재고 1개를 예약하지만 작업을 방치한다. 60초 TTL이 만료되면 재고가 복구되고, 서명된 예약 비용만 bond에서 정산되며 나머지가 반환된다. 이 transaction을 표시한다.

### 2:45–3:00 — 결론

> pay.sh는 실제 허용 호출 비용만 정산했고, Solana는 희소 재고를 잡았을 때만 환불 가능한 책임을 강제했으며, Gemini는 사람의 목적을 기계가 집행할 수 있는 계약으로 바꿨습니다.

> 구현 메모: “20개 노트북”은 Intent Compiler의 권한·상한 eval로 유지한다. 화면 데모는 실제 Gateway `DemoCommerceApi`의 두 SKU(`lap-1`, `lap-2`)를 사용해 trace, 재고, 정산 결과가 서로 일치하도록 한다.

## 2. 화면 구성

```text
┌───────────────┬──────────────────────────┬────────────────────┐
│ Agent Intent  │ Signed Access Contract   │ Money & State      │
│ natural task  │ endpoints / fields / cap │ usage / bond / tx  │
├───────────────┴──────────────────────────┴────────────────────┤
│ Live Decision Trace: allowed and denied calls                │
└───────────────────────────────────────────────────────────────┘
```

채팅창이 주인공이면 안 된다. 핵심 시각화는 자연어가 제한된 계약으로 바뀌고 돈과 접근 상태가 함께 닫히는 장면이다.

## 3. 심사기준 대응

| 평가 포인트 | 증거 |
|---|---|
| AI 활용 | Gemini Intent Compiler, 최소권한 policy diff, fixture eval |
| Agent autonomy | 에이전트가 정책 한도 내 pay.sh 결제와 bond를 사람 추가 승인 없이 실행 |
| Solana/pay.sh | 데이터 호출 사용료와 재고 예약 bond를 분리한 devnet transactions |
| 새로운 UX | API key 발급 대신 intent + refundable bond로 즉시 session |
| 실제 구동 | live trace, transaction hash, receipt hash, Explorer |
| 왜 onchain | 모르는 두 주체 사이의 programmable escrow와 bounded settlement |

## 4. 검증 게이트

### Gate 0 — 전제 검증, D0–D2

- API 공급자 3명, agent builder 3명에게 15분 인터뷰
- 질문: 신규 agent onboarding, API key 마찰, abuse, refundable bond 수용성
- **통과:** 양쪽에서 최소 2명씩 문제가 이해되거나 사용 조건을 제시
- **실패 시:** 시장 제품 주장을 줄이고 agent commerce access protocol prototype으로 발표

### Gate 1 — 위험 기술 spike, D0–D2

- pay.sh 실제 protected endpoint 한 번 결제
- MPP session SDK 가능 여부 확인
- Solana open/refund 최소 transaction
- Gemini structured output schema 통과
- **통과:** 네 경로가 독립적으로 실제 동작
- **실패 시:** 해당 fallback을 즉시 적용하고 표현을 수정

### Gate 2 — Contract freeze, D2

- policy schema v1
- event envelope v1
- gateway endpoints v1
- Solana instruction arguments v1
- Figma/wireframe state list

이후 breaking change는 세 담당자 합의와 Decision Log가 필요하다.

### Gate 3 — Happy path E2E, D5

- natural intent부터 실제 bond refund까지 한 번 완주
- UI가 없어도 curl/script로 먼저 증명

### Gate 4 — Violation E2E, D7

- forbidden path가 upstream에 도달하지 않음
- forbidden path 차단만으로 차감되지 않음
- 예약 방치 시 bounded settlement와 remainder refund 확인
- 중복 settlement 거부

### Gate 5 — Demo quality, D10

- 10회 연속 실행 성공률 90% 이상
- 3분 이내
- 모든 실패가 명시적인 상태로 표시
- tx 링크와 receipt 재조회 가능

### Gate 6 — Pitch validation, D12

기술 배경이 다른 3명에게 보여주고 다음 질문에 답하게 한다.

1. 누가 왜 돈을 걸었는가?
2. pay.sh와 Solana의 역할은 각각 무엇인가?
3. AI가 무엇을 했는가?
4. 왜 API key와 다른가?

한 명이라도 설명하지 못하면 발표 문구나 UI를 수정한다.

## 5. 14일 일정

| 일자 | 공통 목표 | Front/Product | Gateway/AI | Protocol/Chain |
|---|---|---|---|---|
| D0 | 범위·계약 합의 | wireframe | API skeleton | pay.sh/Anchor spike |
| D1–2 | 위험 제거 | event fixture UI | compiler schema | 실제 charge + open/refund |
| D3–4 | 개별 완성 | 5개 핵심 화면 | policy engine + state | program tests + client SDK |
| D5 | happy E2E | live events 연결 | orchestration | bond close |
| D6–7 | violation E2E | denied/receipt UX | deny + receipt | bounded settle |
| D8–9 | GCP 배포 | Cloud Run web | Cloud Run services | devnet deployment |
| D10 | 반복 안정화 | loading/error states | retry/idempotency | tx confirmation handling |
| D11 | 발표 초안 | deck/demo control | architecture evidence | Explorer/evidence |
| D12 | 외부 리허설 | 피드백 반영 | bug fix | bug fix |
| D13 | freeze | visual polish | observability | program freeze |
| D14 | 최종 리허설 | 발표 | 운영 | 운영 |

남는 기간은 기능 추가가 아니라 멘토 피드백, 시연 안정화, 스토리 압축에 사용한다.

## 6. 데모 운영 체크리스트

- [ ] `scripts/demo-reset`으로 fixture와 세션 초기화
- [ ] devnet RPC, pay.sh, Vertex AI health check
- [ ] demo wallet/token balance 확인
- [ ] 실제 endpoint URL과 Explorer 링크 확인
- [ ] 브라우저 cache 없이 리허설
- [ ] transaction pending UI 확인
- [ ] Secret이나 credential이 화면·로그에 보이지 않음
- [ ] 정상/위반 agent 순서 고정
- [ ] 3분 버전과 90초 축약 버전 준비
- [ ] 녹화 백업은 준비하되 live 실행을 우선

## 7. 질문 공격과 답변 원칙

### 그냥 API key면 되지 않나?

반복 고객에게는 API key가 좋다. BotBond는 가입·계약을 할 가치가 없는 일회성·롱테일 agent session을 위한 경로다.

### 악성 봇은 보증금을 안 걸 텐데?

맞다. 악성 트래픽 차단은 WAF 역할이다. BotBond는 공식 접근이 필요한 정상 에이전트의 진입로다.

### pay.sh로 선불 과금하면 bond는 왜 필요한가?

가격·재고 조회 비용은 pay.sh가 담당한다. Bond는 돈을 냈다고 무한정 허용할 수 없는 희소 재고·작업 슬롯 예약을 담보한다. 정상 agent는 반환받고, 예약을 방치해 실제 기회비용을 만든 경우에만 정산된다.

### Cloudflare가 만들면 끝 아닌가?

플랫폼 리스크는 존재한다. BotBond의 기여는 Cloudflare 비종속적인 intent-to-scope, pay.sh 결제, refundable bond의 결합을 실제로 증명하는 것이다.

### 왜 AI인가?

속도 제한은 AI가 필요 없다. 자연어 작업을 merchant별 endpoint·field·한도에 맞는 최소권한 계약으로 만드는 부분에만 AI를 사용한다.

### LLM이 틀리면 돈을 잃나?

아니다. 사용자는 계약을 먼저 받고, 실제 돈의 집행은 서명된 결정적 규칙만 따른다.

### 중앙 서버로도 가능한데 왜 Solana인가?

가능하다. Solana의 장점은 계정·계약 관계가 없는 두 기계가 어느 한쪽의 내부 DB를 신뢰하지 않고 담보 상태와 정산 규칙을 함께 검증하는 것이다.
