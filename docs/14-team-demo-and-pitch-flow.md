# BotBond Submission Package: Deck, Demo, and Reproduction Guide

## 0. 문서 목적

이 문서는 팀원들이 BotBond를 같은 제품으로 설명하고, 같은 기술적 근거를 보여주기 위한 발표·데모 기준이다.

이 문서가 답해야 하는 질문은 다섯 가지다.

1. BotBond가 해결하는 문제는 무엇인가?
2. 기존 API key, WAF, pay-per-use와 무엇이 다른가?
3. 누가 왜 이 제품을 설치하고 사용하는가?
4. Gemini, Gateway, pay.sh, Solana, GCP가 각각 왜 필요한가?
5. 라이브 데모에서 어떤 실제 동작으로 주장을 증명하는가?

제품 범위와 계약의 source of truth는 다음 문서다.

- 제품 범위: `docs/01-product-spec.md`
- 기술 구조: `docs/02-architecture.md`
- API와 event 계약: `docs/03-contracts.md`
- 변경된 기술 사실: `docs/00-decision-log.md`

### 제출물 기준

| 제출물 | 필수 내용 | BotBond 산출물 |
|---|---|---|
| 프로젝트 소개서 PDF | 타깃, 문제, 도입 시나리오, 아키텍처 | 8장 내외의 발표 장표를 PDF로 제출한다. |
| GitHub repository | 재현 가능한 코드와 실행 가이드 | frontend, Gateway, Intent Compiler, Firebase, Solana 코드와 root README를 제공한다. |
| 3분 이내 데모 영상 | 실제 온체인 결제 전 과정 | bond open, bounded settlement, refund와 Explorer 확인을 한 영상에 담는다. |
| 라이브 엔드포인트 | 심사 기간 중 접근 가능한 URL | web과 public Gateway endpoint를 배포하고 health 상태를 유지한다. |

제출물은 같은 session, policy hash, receipt hash, transaction을 사용해야 한다. PDF에서 주장한 결과가 영상과 live endpoint에서 다르면 안 된다.

## 1. 제품 정의

### 한 문장

> BotBond는 처음 보는 AI 에이전트가 사용 목적과 범위를 제시하고 환불 가능한 보증금을 걸면, 계정이나 API key 없이 제한된 API 세션을 즉시 얻도록 하는 agent-access gateway다.

영문:

> BotBond gives unknown AI agents immediate, scoped API access backed by a refundable on-chain bond.

### 더 짧은 발표 문장

> Unknown agents do not need instant trust. They need bounded access and enforceable accountability.

### 제품의 주인공

BotBond의 주인공은 봇 차단이 아니라 **permissionless agent onboarding**이다.

- 사이트 운영자는 처음 보는 에이전트를 전부 차단하지 않아도 된다.
- 정상 에이전트는 가입·심사·장기 계약 없이 일회성 작업을 시작할 수 있다.
- 양쪽은 서명된 사용 범위, 비용 상한, 환불 가능한 bond를 기준으로 거래한다.

## 2. 정확한 포지셔닝

### BotBond가 하는 것

- 사이트 운영자가 직접 설치하는 공식 agent-access gateway
- 구조화된 API와 MCP endpoint를 위한 조건부 접근 통로
- 자연어 목적을 merchant별 최소 권한 정책으로 변환
- 허용된 호출만 사용량 기반으로 정산
- 희소 자원을 점유하는 행동에만 refundable bond 적용
- 객관적인 예약 만료 시 사전 합의된 상한 안에서만 정산

### BotBond가 하지 않는 것

- Cloudflare WAF를 우회하지 않는다.
- 임의 웹사이트의 CAPTCHA를 풀지 않는다.
- 악성·은폐 크롤러를 BotBond만으로 차단하지 않는다.
- 검색엔진이나 학습 크롤러를 주요 고객으로 삼지 않는다.
- LLM이 세션 중단이나 금전 차감을 결정하지 않는다.
- 온체인 평판으로 Sybil 공격을 해결한다고 주장하지 않는다.

### Cloudflare와의 관계

```text
Agent
  |
  v
Cloudflare WAF / Bot Management
  |
  | site operator explicitly allows the agent route
  v
/.well-known/agent-access or /agent-api/*
  |
  v
BotBond Gateway
  |
  v
Origin API
```

Cloudflare는 비협조적인 트래픽을 차단한다. BotBond는 운영자가 명시적으로 연 경로를 통해 협조적인 미등록 에이전트에게 조건부 접근권을 발급한다.

따라서 발표에서 `Cloudflare bypass`, `blocked web access`, `CAPTCHA replacement`를 제품 정의로 사용하지 않는다.

## 3. 목표 사용자

### 공급 측

- 실시간 가격·재고·견적 API를 제공하는 커머스 사업자
- 데이터 API 스타트업
- MCP 또는 tool endpoint 공급자
- API key 발급 비용이 일회성 agent 수요보다 큰 서비스
- 웹3·AI 네이티브 서비스

### 수요 측

- HTTP header와 지갑을 제어할 수 있는 직접 HTTP agent
- 구조화된 API를 호출하는 MCP agent
- 구매·조달·여행·리서치·운영 agent
- 계정이나 장기 계약 없이 일회성 또는 간헐적 접근이 필요한 agent builder

### 주요 대상이 아닌 것

| 유형 | 제외 이유 |
|---|---|
| 학습용 대량 크롤러 | 공식 통로와 refundable bond를 사용할 유인이 약하다. |
| 악성·은폐 크롤러 | UA/IP를 바꾸며 공식 경로 자체를 회피한다. |
| 검색엔진 색인 봇 | BotBond가 제공하는 세션형 API 고객이 아니다. |
| Search API 사용자 | 원본 사이트가 아니라 검색 제공자가 접근한다. |
| 임의 Browser Agent | 사이트가 전용 agent endpoint를 열지 않으면 적용할 수 없다. |

## 4. 왜 기존 방식으로는 부족한가

### 핵심 비교

| 방식 | 잘하는 일 | agent onboarding의 한계 | BotBond의 차이 |
|---|---|---|---|
| WAF / Bot Management | 비협조적 트래픽 차단 | 정상 신생 agent도 unknown으로 묶일 수 있다. | WAF 뒤에 운영자가 연 공식 agent lane을 제공한다. |
| API key | 반복 고객의 장기 인증과 청구 | 가입, 심사, 계약, 카드, 발급 대기가 필요하다. | 일회성 세션을 즉시 발급한다. |
| Rate limit | 호출 속도와 횟수 제한 | 자연어 목적, endpoint 의미, 사후 의무를 표현하지 못한다. | intent를 scope로 바꾸고 계약 전체를 집행한다. |
| Pay-per-use / Pay Per Crawl | 사용한 데이터 비용 정산 | 희소 재고·작업 슬롯을 잡고 방치하는 기회비용을 담보하지 않는다. | 사용료와 별도로 bonded action을 둔다. |
| Web Bot Auth | 알려진 agent identity 검증 | 신생·롱테일 agent는 등록과 평판 형성에 마찰이 있다. | 신원을 모르는 상태에서도 책임을 담보해 제한된 세션을 연다. |
| BotBond | 미등록 agent의 즉시 조건부 접근 | 운영자 통합과 지갑·결제 지원이 필요하다. | intent, bounded access, usage payment, refundable bond를 한 흐름으로 결합한다. |

### API key onboarding과 직접 비교

| 기존 API onboarding | BotBond agent lane |
|---|---|
| 회원가입과 이메일 인증 | 자연어 목적 제출 |
| API 사용 신청과 심사 | merchant catalog 기반 scope 생성 |
| 사업자 정보 또는 카드 등록 | 사용 한도와 bond 조건 확인 |
| 영업일까지 대기 | 세션 즉시 개설 |
| 장기 credential 보관 | 짧은 수명의 scoped token |

## 5. 제품이 작동하는 방식

### 1단계 — 공식 agent lane 발견

미등록 agent의 일반 API 요청은 차단된다.

```http
GET /products
403 Unknown automated client

Agent access available:
GET /.well-known/agent-access
```

운영자가 의도적으로 연 진입점이므로 WAF 우회가 아니다.

### 2단계 — 자연어 목적 제출

```text
150만 원 이하 노트북의 가격과 재고를 비교하고,
가장 좋은 상품 하나를 60초만 예약해줘.
판매자 연락처는 필요 없어.
```

### 3단계 — Gemini Intent Compiler

Gemini는 merchant capability catalog 안에서만 operation을 선택한다.

```json
{
  "allowedOperations": [
    "GET /products",
    "GET /products/{id}/inventory",
    "POST /reservations"
  ],
  "allowedFields": ["name", "price", "stock", "shipping"],
  "maxTotalCalls": 25,
  "reservationMaxActive": 1,
  "reservationTtlSeconds": 60,
  "excluded": ["/seller-contacts", "/users", "/admin"]
}
```

Gateway는 schema, merchant maximum, canonical hash를 검증한다. Agent는 돈을 잠그기 전에 계약을 확인한다.

### 4단계 — 사용료와 bond 준비

- 허용된 데이터 호출: payment rail을 통해 사용량 정산
- 세션 사용량 상한: Gateway와 PaymentAdapter가 호출 전에 집행
- 희소 재고 예약: Solana refundable bond 필요
- 단순 read-only session: bond가 필수는 아님

### 5단계 — 결정적 집행

Gateway가 다음을 코드로 집행한다.

- endpoint와 HTTP method
- response field
- call count와 rate
- expiry와 usage cap
- bonded action의 최대 활성 개수와 TTL

범위 밖 요청은 origin에 전달되지 않으며, 차단만으로 bond가 차감되지 않는다.

### 6단계 — 종료와 정산

- 정상 release 또는 구매: bond 전액 반환
- 범위 밖 호출 시도: 요청 차단, penalty `0`
- 예약 방치와 TTL 만료: inventory 복구, 사전 합의된 금액만 정산, 나머지 반환

## 6. AI가 왜 필요한가

속도 제한과 금전 집행에는 AI가 필요 없다. AI가 필요한 지점은 merchant마다 다른 API 구조에 자연어 목적을 매핑하는 과정이다.

같은 요청:

> 가격과 재고만 비교해줘.

| Merchant catalog | 컴파일된 최소 권한 |
|---|---|
| Northstar Supply | `GET /products`, `GET /products/{id}/inventory` |
| Orbit Market | `GET /catalog/search`, `GET /stock/{sku}` |

고정 if문으로 구현하면 merchant마다 사람이 intent-to-endpoint mapping을 만들어야 한다. Gemini는 catalog를 해석해 필요한 operation과 field만 제안한다.

안전 경계는 명확하다.

```text
Gemini proposes a policy.
Gateway validates and enforces it.
Solana enforces the signed monetary ceiling.
```

AI는 penalty를 판정하거나 자금을 이동할 권한이 없다.

## 7. 기술별 필연성

| 구성요소 | 담당 역할 | 없으면 생기는 문제 |
|---|---|---|
| Gemini / Vertex AI | 자연어 목적을 merchant capability 기반 최소 권한 정책으로 컴파일 | merchant마다 수동 mapping이 필요하고 agent UX가 다시 개발자 문서 탐색으로 돌아간다. |
| Gateway | scope, rate, count, expiry, usage cap을 결정적으로 집행 | LLM 출력이 직접 권한이 되어 안전 경계가 사라진다. |
| pay.sh / payment adapter | 허용된 유료 API 호출의 사용료 정산 | 데이터 공급자가 정상 agent 호출 비용을 회수하지 못한다. |
| Solana program | bond 잠금, 최대 penalty, bounded settlement, refund를 공개 규칙으로 강제 | merchant 내부 DB를 신뢰해야 하고 일방적 차감 우려가 생긴다. |
| Firebase / Firestore | session, event, inventory, reservation, idempotency와 재시작 복구 상태 저장 | 다중 인스턴스와 SSE 재연결에서 상태와 정산 이력이 갈라진다. |
| Cloud Run / GCP | Gateway와 Intent Compiler 실행, Vertex AI·Firestore·로그 연결 | 라이브 서비스 경로와 재현 가능한 실행 증거가 없다. |
| Next.js frontend | agent와 merchant가 계약, 접근, inventory, 정산 근거를 이해 | backend 로그만 남아 제품 가치가 보이지 않는다. |

### pay.sh 표현 경계

현재 저장소에서 확인된 사실은 다음과 같다.

- pay.sh sandbox의 x402 per-call rail은 별도 검증됐다.
- 현재 Gateway HMAC credential bridge는 live pay.sh integration이 아니다.
- live adapter 전까지 `FAKE_ADAPTER_FIXTURE`를 반드시 노출한다.
- 세션 cap은 Gateway와 PaymentAdapter가 집행한다고 설명한다.
- pay.sh가 bond나 penalty를 제공한다고 말하지 않는다.
- MPP capped session을 실제로 검증하기 전에는 구현했다고 말하지 않는다.

## 8. 프론트 UX 구조

기존의 Intent / Contract / Money / Trace 동시 노출 dashboard는 개발 검증 화면으로 유지할 수 있지만 발표의 기본 화면으로 사용하지 않는다.

라이브 제품 화면은 다음 단계로 분리한다.

| 화면 | 사용자가 이해해야 하는 한 가지 |
|---|---|
| Access denied | 일반 경로는 unknown agent를 차단하지만 공식 agent lane이 있다. |
| Intent request | agent가 원하는 작업과 예산을 자연어로 제출한다. |
| Access contract | Gemini 결과와 사용 한도, bond 조건을 돈을 잠그기 전에 검토한다. |
| Active session | 허용된 상품 조회와 inventory reservation이 실제로 실행된다. |
| Settlement receipt | 누가 얼마를 받았고 어떤 결정적 근거로 정산됐는지 확인한다. |

원칙:

- 한 화면에서 미래 결과까지 모두 보여주지 않는다.
- commerce 상품과 inventory 변화가 주인공이다.
- raw event, JSON, transaction은 기본 화면이 아니라 evidence drawer에 둔다.
- fixture와 live 상태를 명확하게 표시한다.
- confirmed transaction만 Explorer 링크를 제공한다.

## 9. 라이브 데모 흐름

데모는 하나의 실제 session으로 제품 메커니즘과 온체인 정산을 증명한다.

### Step 1 — 차단과 discovery

1. DemoCommerceApi의 상품 API를 미등록 상태로 호출한다.
2. 실제 `403`과 `/.well-known/agent-access` 경로를 확인한다.
3. 프론트는 NovaBook Air와 마지막 재고 `1`을 보여준다.

**증명:** BotBond는 우회가 아니라 운영자가 연 공식 통로다.

### Step 2 — Intent Compiler

1. 자연어 가격·재고 비교 요청을 제출한다.
2. 실제 Intent Compiler가 policy를 생성한다.
3. schema validation, excluded paths, policy hash를 확인한다.

**증명:** AI는 목적을 merchant별 실행 가능한 계약으로 변환한다.

### Step 3 — Session과 bond 개설

1. payment credential 상태를 검증한다.
2. Solana devnet에서 1.00 USDC bond를 연다.
3. transaction confirmation 후 scoped session을 `ACTIVE`로 만든다.

**증명:** unknown agent가 장기 계정 없이 제한된 접근권을 얻는다.

### Step 4 — 허용된 호출과 범위 차단

1. 상품·가격·재고 endpoint를 실제 호출한다.
2. `/seller-contacts`를 한 번 요청한다.
3. Gateway가 origin 전달 전에 차단한다.
4. usage charge와 bond penalty가 모두 증가하지 않았음을 확인한다.

**증명:** 차단과 금전 처벌은 다르며, AI가 임의로 돈을 가져가지 않는다.

### Step 5 — 마지막 재고 예약

1. NovaBook Air 마지막 1대를 예약한다.
2. inventory가 실제로 `1 -> 0`이 된다.
3. 동일 상품에 대한 별도 구매 시도가 inventory 부족으로 실패한다.
4. agent는 예약을 release하거나 consume하지 않는다.

**증명:** bond는 단순 API 조회가 아니라 merchant에게 기회비용을 만드는 행동에 의미가 있다.

### Step 6 — TTL 만료와 bounded settlement

1. 실제 60초 TTL이 만료된다.
2. expiry worker가 inventory를 `0 -> 1`로 복구한다.
3. Solana program이 `0.25 USDC`만 merchant에 정산한다.
4. 나머지 `0.75 USDC`를 agent에게 반환한다.
5. usage `0.003 USDC`, policy hash, receipt hash, confirmed transaction을 확인한다.

**증명:** 운영자는 실제 기회비용 일부를 보전받고, agent는 전액 몰수가 아니라 합의된 상한만 부담한다.

## 10. 3분 데모 타임라인

| 시간 | 보여줄 내용 | 핵심 설명 |
|---|---|---|
| 0:00-0:20 | 403과 official agent lane | unknown agent를 무조건 신뢰하지 않고 공식 경로로 보낸다. |
| 0:20-0:50 | 자연어 intent와 compiled contract | Gemini가 merchant catalog 기반 최소 권한을 만든다. |
| 0:50-1:15 | payment 상태, bond open, session ACTIVE | 계정·API key 없이 제한된 session이 열린다. |
| 1:15-1:40 | 허용 호출과 `/seller-contacts` 차단 | forbidden request는 upstream 0, penalty 0이다. |
| 1:40-2:10 | 마지막 재고 reservation `1 -> 0` | 희소 자원 점유 때문에 bond가 필요하다. |
| 2:10-2:40 | TTL expiry와 inventory `0 -> 1` | 코드가 객관적 만료를 집행한다. |
| 2:40-3:00 | settlement receipt와 Explorer | usage 0.003, settled 0.25, returned 0.75를 검증한다. |

실제 60초 TTL을 기다리는 동안에는 제품 설명과 기술 구조를 짧게 설명한다. 시간을 줄이기 위해 fixture clock을 쓰는 경우 화면 전체를 `DEMO SIMULATION`으로 표시한다.

## 11. 프로젝트 소개서 PDF 구성

장표는 제품을 모르는 심사위원이 `문제 -> 대상 -> 차이 -> 작동 방식 -> 기술 근거 -> 실제 증거` 순서로 이해하도록 구성한다. 화면 연출이나 등장인물 설정을 넣지 않는다.

### Slide 1 — 제품 정의

**제목:** API keys were built for organizations, not autonomous agents.

포함 내용:

- BotBond 한 문장 정의
- `permissionless agent onboarding`이라는 제품 범주
- `Unknown agent -> bounded API customer` 흐름

### Slide 2 — 타깃과 해결 문제

**타깃 공급자**

- 실시간 가격·재고·견적 API 사업자
- 데이터 API와 MCP 공급자
- 일회성 agent 수요가 있지만 API key 심사가 과도한 서비스

**타깃 agent**

- 직접 HTTP 또는 MCP agent
- 구매·조달·여행·리서치 agent
- header, payment, wallet을 제어할 수 있는 agent builder

**해결 문제**

- WAF는 unknown automation을 차단해야 한다.
- API key는 가입, 심사, 계약, 장기 credential을 전제로 한다.
- 정상적인 미등록 agent가 즉시 사용할 공식 경로가 없다.

### Slide 3 — 기존 대안 비교

섹션 4의 비교표를 장표용으로 축약한다.

| 대안 | 해결하는 것 | 남는 공백 |
|---|---|---|
| WAF / Cloudflare | 비협조적 트래픽 차단 | 정상 unknown agent의 onboarding |
| API key | 장기 고객 인증·청구 | 일회성 접근의 가입·심사 비용 |
| Rate limit | 호출량 통제 | 자연어 목적과 endpoint 의미 |
| Pay-per-use | 데이터 사용료 | 희소 자원의 사후 의무와 담보 |
| Web Bot Auth | 알려진 agent identity | 미등록 agent의 즉시 책임 증명 |
| BotBond | intent 기반 제한 세션과 bonded action | 운영자 통합과 지갑 지원 필요 |

핵심 문장:

> Web Bot Auth proves identity. BotBond makes bounded behavior economically accountable.

### Slide 4 — 도입 시나리오

운영자가 기존 API 앞에 BotBond Gateway를 설치한다.

```text
일반 요청
Agent -> WAF / Bot Management -> 기존 정책 또는 차단

공식 agent 요청
Agent -> WAF allowlisted path -> BotBond Gateway -> Scoped Origin API
```

도입 후 요청 흐름:

```text
Discover agent lane
  -> Submit natural-language intent
  -> Review merchant-scoped contract
  -> Verify payment and open optional bond
  -> Receive short-lived scoped token
  -> Use allowed API operations
  -> Close, refund, or bounded settlement
```

이 장표에서 Cloudflare를 대체하거나 우회한다고 표현하지 않는다.

### Slide 5 — 제품 메커니즘

```text
Gemini            Gateway              Payment             Solana
Intent -> Policy  -> Enforce scope  -> Settle usage   -> Lock/refund bond
```

명확히 분리할 내용:

- Gemini: 자연어를 merchant capability 기반 policy로 변환
- Gateway: endpoint, field, rate, call, expiry, cap 집행
- payment rail: 허용된 데이터 호출 비용 정산
- Solana: bonded action의 담보, 최대 정산액, 반환 강제

### Slide 6 — 아키텍처 다이어그램

```text
Agent Client
    |
    | intent, payment credential, scoped calls
    v
BotBond Gateway on Cloud Run
    |-- Vertex AI Gemini Intent Compiler
    |-- Firebase / Firestore state and ordered events
    |-- Protected DemoCommerceApi
    |-- pay.sh / payment adapter
    `-- Solana devnet BotBond program
             |
             `-- open bond, bounded settlement, refund

Next.js Demo App
    `-- Gateway API + authenticated SSE + evidence links
```

Browser가 Firestore에 직접 접근하지 않는다는 보안 경계도 표시한다.

### Slide 7 — 실제 검증 결과

라이브 데모와 같은 숫자를 사용한다.

- unknown request: `403` + official agent discovery
- policy: catalog 밖 endpoint `0`
- forbidden request: upstream exposure `0`, penalty `0`
- inventory: `1 -> 0 -> 1`
- usage: `0.003 USDC`
- expiry settlement: `0.25 USDC`
- agent refund: `0.75 USDC`
- Solana transaction: confirmed Explorer evidence

### Slide 8 — 차별점, 한계, 제출 링크

**차별점**

- 계정 없는 agent onboarding
- merchant별 intent-to-scope
- usage payment와 refundable bonded action의 분리
- AI가 금전 권한을 갖지 않는 구조

**현재 한계**

- 운영자가 agent route를 설치해야 한다.
- WAF는 별도로 필요하다.
- Gateway는 MVP trust assumption이다.
- live pay.sh Gateway integration이 아니면 fixture로 표시한다.

**제출 링크**

- GitHub repository
- 3분 데모 영상
- live web endpoint
- public Gateway discovery endpoint
- Solana Explorer program과 transaction

## 12. GitHub 재현성 요구사항

Root `README.md`는 심사위원이 별도 설명 없이 로컬 실행과 검증을 재현할 수 있도록 다음 순서를 제공해야 한다.

1. 시스템 요구사항: Node 22, Python 3.12, Rust/Anchor/Solana, Java 21, Firebase CLI
2. 저장소 설치 명령
3. `.env.example`과 필요한 변수 설명
4. Firebase emulator 실행 방법
5. Gateway, Intent Compiler, frontend 실행 방법
6. local validator 또는 devnet 선택 방법
7. fixture reset과 demo seed 명령
8. 전체 E2E 또는 smoke 명령
9. 예상 출력과 Explorer 확인 방법
10. 현재 fake/live adapter 경계

README에 secret 값을 넣지 않는다. GCP project, Firebase project, IAM, wallet 설정은 이름과 절차만 기록한다.

Repository의 최소 검증 명령은 한 곳에서 실행 가능해야 한다.

```text
npm install
npm run build
npm test
npm run demo:reset
npm run demo:smoke
```

실제 명령이 다르면 구현 완료 시 위 예시를 저장소 명령에 맞게 갱신한다.

## 13. 3분 데모 영상 구성

영상은 UI 설명보다 실제 온체인 결제 전 과정의 연속성을 우선한다. 편집으로 서로 다른 session의 결과를 한 session처럼 붙이지 않는다.

| 시간 | 실제 동작 | 화면 증거 |
|---|---|---|
| 0:00-0:20 | 미등록 request와 official discovery | `403`, `/.well-known/agent-access` |
| 0:20-0:45 | intent compile | natural-language intent, policy, hash |
| 0:45-1:10 | payment 상태와 bond open | session ID, Solana confirmed transaction |
| 1:10-1:35 | 허용 호출과 forbidden 호출 | allowed usage, upstream `0`, penalty `0` |
| 1:35-2:05 | 마지막 재고 reservation | inventory `1 -> 0`, bond locked |
| 2:05-2:35 | TTL expiry와 bounded settlement | inventory `0 -> 1`, settlement transaction |
| 2:35-3:00 | refund와 최종 영수증 | usage `0.003`, settled `0.25`, returned `0.75`, Explorer |

영상에 반드시 포함할 온체인 단계:

1. bond account 또는 PDA 생성
2. agent 자금의 escrow 잠금
3. reservation expiry evidence와 bounded settlement 요청
4. merchant 정산
5. agent remainder refund
6. transaction confirmation과 Explorer 확인

온체인 단계가 fixture이면 이 제출 요건을 충족한 것으로 표현하지 않는다.

## 14. 라이브 배포 엔드포인트

심사 기간 동안 다음 URL을 유지하는 것을 목표로 한다.

| 공개 대상 | 요구사항 |
|---|---|
| Web app | 제출자가 아닌 사람도 기본 데모 흐름을 실행할 수 있어야 한다. |
| `/.well-known/agent-access` | protocol, intent endpoint, payment/bond 상태를 반환해야 한다. |
| Gateway health | 배포 revision과 dependency 상태를 확인할 수 있어야 한다. |
| Solana Explorer | program ID와 confirmed demo transaction을 확인할 수 있어야 한다. |

Intent Compiler 내부 endpoint, Firestore, secret, settlement signer는 공개하지 않는다.

현재 검증된 공개 URL과 최신 devnet transaction은 `docs/15-live-deployment-evidence.md`를 기준으로 한다. 소개서와 영상은 그 문서의 동일 session ID, policy hash, 금액, Explorer 링크를 사용한다.

운영 체크:

- demo reset을 인증된 관리 경로로 제한
- wallet과 devnet token 잔액 확인
- Cloud Run cold start와 timeout 확인
- SSE reconnect 확인
- fixture/live 표시 확인
- 심사 기간 중 health monitor와 녹화 백업 유지

## 15. 예상 질문과 짧은 답변

### 그냥 API key를 발급하면 되지 않나?

반복 고객에게는 API key가 더 효율적이다. BotBond는 가입·계약 비용이 맞지 않는 일회성·간헐적·롱테일 agent session을 위한 경로다.

### Cloudflare가 이미 하는 일 아닌가?

Cloudflare는 WAF, identity, pay-per-use를 제공한다. BotBond는 운영자가 연 API/MCP 경로에서 natural-language intent, scoped session, refundable bonded action을 결합한다. Cloudflare를 우회하지 않고 뒤에서 보완한다.

### 악성 봇이 bond를 걸지 않으면 어떻게 하나?

그 봇은 BotBond 고객이 아니다. WAF가 비공식 경로를 차단하고 BotBond는 공식 접근이 필요한 협조적인 agent를 받는다.

### 그냥 rate limit이면 되지 않나?

속도와 호출 수는 rate limit으로 충분하다. BotBond는 자연어 목적을 merchant별 endpoint·field 계약으로 만들고, 예약 같은 사후 의무와 refundable bond를 함께 다룬다.

### 왜 blockchain인가?

서로 계정이나 계약 관계가 없는 두 기계가 어느 한쪽의 내부 DB만 신뢰하지 않고 담보 금액, 최대 정산액, 반환 결과를 검증하기 위해서다. 중앙 escrow로도 가능하지만 Solana는 공개된 프로그램 규칙으로 상한을 강제한다.

### LLM 오판으로 돈을 잃을 수 있나?

없도록 설계했다. Gemini는 policy를 제안하고 사용자가 계약을 먼저 확인한다. 실제 정산은 endpoint, TTL, signed ceiling 같은 결정적 조건만 사용한다.

### 지갑을 바꾸면 평판이 초기화되지 않나?

맞다. 그래서 MVP는 지갑 평판이나 자동 bond 상승을 핵심 가치로 주장하지 않는다. bond 조건은 요청 범위와 희소 자원 비용으로 계산한다.

## 16. 팀별 구현 책임

### Role A — Frontend / Product Experience / Antigravity

- 기존 dashboard를 단계별 product flow로 재구성
- commerce product, access contract, active session, settlement receipt 구현
- SSE 상태 복구와 pending/error 처리
- fixture/live 표시와 evidence drawer
- 발표용 reset과 deterministic demo control

### Role B — Gateway / Gemini / Firebase / GCP

- discovery, intent, session, protected API, SSE orchestration
- merchant capability catalog와 Gemini structured output
- Firestore session, event, inventory, reservation, settlement journal
- TTL worker와 inventory recovery
- Cloud Run, Firebase, IAM 배포는 사용자 승인 후 수행

### Role C — Payment / Solana

- 실제 pay.sh rail과 Gateway integration 상태를 구분
- Solana devnet bond open, refund, bounded settlement
- transaction confirmation과 Explorer evidence
- max penalty, conservation, replay·duplicate settlement 방지

## 17. 라이브 표시 기준

`LIVE`라고 표시하려면 같은 session ID와 trace ID에 대해 다음이 실제로 연결되어야 한다.

1. compiler provider output
2. Firestore session과 ordered events
3. protected API inventory 변화
4. payment adapter result
5. Solana confirmed transaction
6. final receipt

일부 rail만 fixture이면 전체를 live라고 부르지 않고 해당 항목에 `FAKE_ADAPTER_FIXTURE` 또는 `DEMO SIMULATION`을 표시한다.

## 18. 구현 완료 기준

- 처음 보는 agent가 official agent lane을 발견한다.
- 실제 intent가 merchant catalog 밖 endpoint를 만들지 않는다.
- payment와 bond 확인 전 bonded action이 실행되지 않는다.
- 허용 요청만 origin에 도달하고 사용료가 기록된다.
- forbidden request는 upstream `0`, penalty `0`이다.
- 마지막 재고가 `1 -> 0 -> 1`로 실제 변경된다.
- expiry만 `0.25 USDC`를 정산하고 `0.75 USDC`를 반환한다.
- 새로고침과 SSE 재연결 후 Firestore 상태에서 같은 session을 복구한다.
- confirmed transaction만 Explorer로 연결된다.
- 비개발자가 20초 안에 `API key 없는 조건부 agent access`라고 설명할 수 있다.

## 19. 외부 사실 사용 규칙

Cloudflare 정책, 시장 점유율, bot traffic 통계는 발표 자료에 넣기 전에 원문 URL과 발표일을 다시 확인한다.

특히 2026년 9월 15일 정책은 다음 범위를 과장하지 않는다.

- Cloudflare에 새로 onboarding되는 domain
- 광고가 표시되는 page
- Training 및 Agent crawler 기본 차단
- Search crawler 기본 허용
- 운영자가 설정 변경 가능

안전한 발표 문장:

> 9월부터 Cloudflare에 새로 들어오는 광고 기반 사이트는 AI Agent를 기본 차단하기 시작합니다. 에이전트에게 필요한 것은 우회가 아니라, 운영자가 자발적으로 열어줄 수 있는 책임 있는 접근 방식입니다.

## 20. 변경 규칙

발표 문구와 실제 구현이 다르면 UI를 그럴듯하게 맞추지 않는다.

- 실제 rail이 없으면 fixture로 표시한다.
- 숫자가 바뀌면 receipt, fixture, 발표 자료를 함께 갱신한다.
- 제품 범위가 바뀌면 `docs/00-decision-log.md`에 먼저 기록한다.
- contract가 바뀌면 `docs/03-contracts.md`와 contract test를 먼저 갱신한다.
