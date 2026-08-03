# Bring your agent — 공개 devnet 연동 가이드

BotBond는 Cloudflare를 우회하지 않는다. 사이트 운영자가 WAF 뒤에 명시적으로 연 agent-access 경로에서, API key가 없는 외부 에이전트에게 짧고 제한된 API 세션을 발급한다.

```text
일반 자동화 요청
Agent → Cloudflare WAF / Bot Management → 기존 정책 또는 차단

공식 에이전트 요청
Agent → WAF에서 허용한 /.well-known/agent-access 및 /agent-api/*
      → BotBond Gateway → scoped origin API
```

따라서 Cloudflare와 BotBond의 역할은 다르다.

| 계층 | 역할 |
|---|---|
| Cloudflare / WAF | 비협조적·은폐 트래픽 차단 |
| BotBond | 협조적인 미등록 에이전트의 목적·범위·비용을 제한한 즉시 온보딩 |
| Origin API | 운영자가 공개하기로 한 구조화 데이터와 행동만 제공 |

## 1. 공개 실행기를 바로 사용하기

BShop의 **Agent API** 화면에서 행동을 고른 뒤 `Run a fresh devnet session`을 누른다. 서버가 데모 지갑을 후원하지만, 다음 과정은 매 실행마다 새로 수행된다.

1. Vertex AI Gemini가 자연어 목적을 BShop catalog 기반 정책으로 컴파일한다.
2. Solana devnet에서 새 bond PDA를 만들고 테스트 토큰을 잠근다.
3. 실제 Gateway session을 발급한다.
4. 브라우저의 공개 데모 에이전트가 허용·차단·예약 API를 호출한다.
5. 정상 종료 또는 TTL 위반에 따라 새 refund/settlement 트랜잭션을 만든다.
6. 두 트랜잭션을 Solana Explorer에서 확인한다.

공개 실행기는 IP 대기시간을 두지 않는다. 원문 IP는 저장하지 않으며, 일일 30회와 동시에 1개 실행으로만 제한한다. 임의 URL·임의 task·임의 금액은 후원 실행기에 전달할 수 없다.

## 2. 자기 지갑으로 전체 흐름 실행하기

준비물:

- Node.js 22+
- Solana CLI
- devnet SOL이 있는 키페어

```bash
solana config set --url devnet
solana airdrop 1
npm install
npm run example:external-agent -- \
  --gateway https://botbond-gateway-752329931962.us-central1.run.app \
  --wallet ~/.config/solana/id.json
```

이 예제는 서버의 wallet secret을 사용하지 않는다. 실행자가 자기 지갑으로 다음을 수행한다.

```text
GET  /.well-known/agent-access
POST /v1/intents
create devnet test mint
open BotBond bond on Solana devnet
POST /v1/payment-challenges
POST /v1/devnet/payment-credentials
POST /v1/sessions
pay.sh x402 sandbox GET /v1/access/:sessionId/products
pay.sh x402 sandbox GET /v1/access/:sessionId/products/lap-2/inventory
POST /v1/access/:sessionId/reservations
POST /v1/access/:sessionId/reservations/:id/release
POST /v1/sessions/:sessionId/close
```

마지막 출력에는 서로 다른 두 Explorer URL이 나온다.

- `bondOpen`: 실행자 서명으로 생성한 bond PDA와 escrow 잠금
- `settlement`: Gateway settlement authority가 실행한 반환 트랜잭션

## 3. 직접 HTTP 에이전트를 작성하기

먼저 discovery 문서를 읽는다.

```bash
curl https://botbond-gateway-752329931962.us-central1.run.app/.well-known/agent-access
```

자연어 목적과 지갑, 비용 상한을 제출한다.

```bash
curl -X POST https://botbond-gateway-752329931962.us-central1.run.app/v1/intents \
  -H 'content-type: application/json' \
  -d '{
    "task":"Compare laptop price and live inventory. Do not access seller contacts.",
    "agentWallet":"<SOLANA_PUBLIC_KEY>",
    "budget":{"usageCapAtomic":"200000","bondCapAtomic":"1000000"}
  }'
```

응답의 `policy`, `policyHash`, `paymentTerms`, `bondTerms`를 검토한다. 에이전트는 이 policy hash를 그대로 온체인 bond에 넣어야 한다. Gateway는 amount와 hash가 일치하는 confirmed bond만 받는다.

활성화 뒤에는 BotBond token을 전용 헤더에 넣는다. `Authorization`은 결제 미들웨어가 사용할 수 있으므로 분리했다.

```http
x-botbond-session-token: <opaque-session-token>
```

## 4. 운영자 설치

운영자는 공개 전체 웹사이트가 아니라 구조화 API 또는 MCP tool 앞에 Gateway를 둔다.

Cloudflare 예시 정책:

```text
/.well-known/agent-access  → GET 공개
/agent-api/v1/intents     → POST 공개 + rate limit
/agent-api/v1/sessions    → POST 공개 + rate limit
/agent-api/v1/access/*    → BotBond session token 필수
/products/*               → 기존 WAF 정책 유지
```

Origin은 인터넷에서 직접 접근되지 않도록 하고 Gateway service identity에서 온 요청만 받는다. BotBond route를 열었다는 이유로 일반 크롤러 정책을 완화하면 안 된다.

## 5. 현재 결제 경계

Solana bond open·refund·bounded settlement는 실제 devnet 트랜잭션이다. pay.sh x402 rail도 공개 Cloud Run gate에서 실제 sandbox `402 → payment → scoped API 200`으로 실행한다. 반면 BotBond 세션을 활성화하는 credential 자체는 여전히 `HMAC_DEMO_BRIDGE`다. 따라서 이를 live pay.sh session verification이나 MPP capped session이라고 주장하지 않는다.

운영 전환 시 교체 지점은 `PaymentAdapter` 하나다.

```text
현재 데이터 호출: hosted pay.sh x402 sandbox gate
현재 세션 활성화: /v1/devnet/payment-credentials → HMAC demo credential
운영 목표: pay.sh 결제 증거를 직접 검증하는 production session credential
그 이후 policy, Gateway enforcement, bond program, receipt 구조는 동일
```

## 6. 테스트 토큰 주의

공개 실행기와 외부 예제의 SPL token은 devnet 테스트 자산이며 USDC가 아니다. 화면의 금액 단위는 계약 계산을 설명하기 위한 6-decimal demo unit이다. 실제 배포에서는 운영자가 허용한 stablecoin mint만 Gateway와 프로그램 계층에서 검증해야 한다.
