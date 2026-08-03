# BotBond 프로젝트 소개서 v2 — 10장 구성

이 문서는 `botbond-deck.pdf`의 시각 스타일과 핵심 포지셔닝을 유지하면서, 제품 사용 주체·Cloudflare 경계·실제 구현 상태·재현 방법을 더 분명하게 만든 개정 원고다.

## 01 — 문제

### API keys were built for organizations, not autonomous agents.

처음 보는 외부 에이전트가 가격·재고·견적 API를 한 번 사용하려 해도 선택지는 두 개뿐이다.

- WAF에서 unknown automation으로 차단
- 회원가입·심사·계약을 거쳐 장기 API key 발급

**BotBond는 세 번째 경로다. 목적·범위·비용을 제한하고, 환불 가능한 담보를 받은 뒤 짧은 API 세션을 즉시 연다.**

제품 범주: `Permissionless agent onboarding for structured APIs`

## 02 — 누구를 위한 제품인가

### 고객은 악성 크롤러가 아니라 공식 경로가 필요한 미등록 에이전트다

공급자:

- 실시간 가격·재고·예약·견적 API 사업자
- MCP·데이터 API 공급자
- 일회성 agent 수요가 있지만 API key 심사가 과도한 서비스

사용자:

- 직접 HTTP/MCP 요청과 wallet을 제어하는 agent builder
- 구매·조달·여행·리서치·운영 에이전트

제외:

- 학습용 대량 크롤러
- IP·UA를 숨기는 악성 봇
- 임의 사이트 CAPTCHA 우회
- 운영자가 BotBond route를 설치하지 않은 웹사이트

## 03 — 경쟁자는 CAPTCHA가 아니라 API key 발급 절차다

| 방식 | 잘하는 일 | 남는 공백 |
|---|---|---|
| Cloudflare / WAF | 비협조적 트래픽 차단 | 협조적인 unknown agent onboarding |
| API key | 장기 고객 인증·청구 | 일회성 접근의 가입·심사 비용 |
| Rate limit | 호출량 통제 | 자연어 목적과 merchant별 endpoint 의미 |
| pay-per-use | 데이터 사용료 | 예약 등 사후 의무의 담보 |
| Web Bot Auth | 알려진 agent identity | 미등록 agent의 즉시 책임 증명 |

> Web Bot Auth proves identity. BotBond makes bounded behavior economically accountable.

## 04 — 실제 제품에는 세 명의 사용자가 있다

### 1. Customer Shop

사람이 상품을 보고 결제하는 기존 BShop. BotBond UI가 개입하지 않는다.

### 2. External Agent Console

미등록 에이전트가 `403`과 discovery 문서를 받고 intent → policy → bond → scoped session을 진행한다.

### 3. Merchant Ops

운영자가 동일 세션의 재고, 허용/차단 요청, usage meter, refund/penalty, Explorer 증거를 본다.

세 화면은 같은 대시보드의 탭이 아니라 `/shop`, `/agent`, `/merchant`라는 독립 경로다. 개발자 설치 문서는 `/integrate`에 둔다.

## 05 — Cloudflare를 우회하지 않는다

```text
일반 자동화 요청
Agent → Cloudflare WAF / Bot Management → 기존 정책 또는 차단

운영자가 승인한 agent route
Agent → WAF allowlisted path → BotBond Gateway → Scoped Origin API
```

운영자가 공개하는 경로:

```text
GET  /.well-known/agent-access
POST /agent-api/v1/intents
POST /agent-api/v1/sessions
*    /agent-api/v1/access/*     BotBond token 필수
```

**Cloudflare는 비협조적 봇을 막고, BotBond는 협조적인 미등록 에이전트에게 조건부 정식 통로를 연다.**

데모의 `403`은 BShop Gateway가 동일 정책을 재현한 것이며 실제 Cloudflare zone 이벤트라고 주장하지 않는다.

## 06 — 자연어가 집행 가능한 계약이 된다

입력:

> 1,500 이하 노트북의 가격과 재고를 비교하고 마지막 한 대를 예약해줘. 판매자 연락처와 리뷰는 필요 없어.

Vertex AI Gemini 결과:

```json
{
  "allowed": [
    "GET /products",
    "GET /products/{id}/inventory",
    "POST /reservations"
  ],
  "forbidden": ["/seller-contacts", "/reviews"],
  "max_calls": 25,
  "max_rate": "5/min",
  "reservation_ttl": "60s"
}
```

같은 자연어라도 merchant catalog가 다르면 endpoint와 field가 달라진다. Gemini는 제안·컴파일만 하고, 차단과 정산은 결정론적 규칙이 수행한다.

## 07 — 요청이 어디서 멈췄는지 보여준다

```text
External Agent → Edge Policy → BotBond Gateway → Origin API
```

세 가지 결과:

| 요청 | 결과 | Origin 도달 | Bond 변화 |
|---|---|---:|---:|
| session 없이 재고 조회 | edge policy 403 | 아니오 | 없음 |
| session으로 허용된 재고 조회 | Gateway allow | 예, 허용 field만 | 없음 |
| session으로 seller contacts 조회 | Gateway scope 403 | 아니오 | 없음 |
| 예약 후 TTL 방치 | objective expiry | 예약만 origin 도달 | 0.25 제한 정산 |

핵심: **차단은 곧 몰수가 아니다. 실제로 비용을 만든 bonded action의 객관적 위반만 제한 정산한다.**

## 08 — 무엇이 실제로 동작하는가

| 구성 | 현재 상태 | 데모에서 보이는 증거 |
|---|---|---|
| Vertex AI Gemini | **LIVE** | 실행마다 새 policy와 policy hash |
| Firestore / Cloud Run | **LIVE** | session state, ordered events, public endpoint |
| Solana bond program | **LIVE DEVNET** | bond open + refund/settlement Explorer tx |
| BShop edge 403 | **DEMO POLICY** | 실제 Gateway 403, Cloudflare zone 연동은 아님 |
| pay.sh x402 | **HOSTED SANDBOX** | 공개 Cloud Run gate에서 실제 402 → sandbox payment → scoped product 200 |
| 배포 세션 usage credential | **DEMO BRIDGE** | HMAC credential + Gateway metering, live pay.sh verifier 아님 |

이 표는 발표에서 숨기지 않는다. pay.sh per-call rail은 실제 공개 sandbox 경로지만 세션 활성화 verifier는 아니며, Cloudflare zone 연동은 없다.

## 09 — 실제 온체인 데모

한 번의 공개 실행에서:

1. `Run a fresh devnet session`
2. 새 bond PDA와 open signature 생성
3. 허용 요청 200 / forbidden 요청 403
4. 재고 `1 → 0 → 1`
5. 정상: bond 전액 반환
6. 방치: penalty 0.25 / remainder 0.75
7. 서로 다른 open·settlement signature를 Explorer에서 확인

화면에는 고정 fixture가 아니라 녹화 중 생성된 session ID, policy hash, receipt hash, signature를 표시한다.

## 10 — 누구나 재현할 수 있다

웹 체험:

```text
https://botbond-bshop.vercel.app/agent
```

자기 에이전트·자기 devnet wallet:

```bash
npm run example:external-agent -- \
  --gateway https://botbond-gateway-752329931962.us-central1.run.app \
  --wallet ~/.config/solana/id.json
```

공개 산출물:

- GitHub reproducible code + README
- public discovery endpoint
- live BShop endpoint
- Solana program + transaction evidence
- 3분 실제 실행 영상

마지막 문장:

> Unknown agents do not need instant trust. They need bounded access and enforceable accountability.
