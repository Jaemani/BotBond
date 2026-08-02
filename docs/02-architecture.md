# Technical Architecture

## 1. 설계 목표

- 3명이 서로 다른 컴포넌트를 병렬 구현할 수 있어야 한다.
- pay.sh와 Solana를 각각 실제 역할에 사용한다.
- Gemini가 돈을 직접 움직이지 않으면서도 제품 핵심에 있어야 한다.
- 해커톤 데모는 재현 가능하고 실패 원인이 화면에 드러나야 한다.
- production을 과장하지 않되 확장 경로가 보여야 한다.

## 2. 논리 아키텍처

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Agent Client                                                        │
│ task + wallet + pay.sh client                                       │
└───────────────┬─────────────────────────────────────────────────────┘
                │ 1. discover / submit intent
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Agent Access Gateway — Cloud Run / TypeScript / Fastify             │
│ discovery · session orchestration · token · policy enforcement      │
│ pay.sh · reservation lifecycle · receipt · protected API proxy      │
└───────┬───────────────────┬─────────────────────┬───────────────────┘
        │                   │                     │
        │ 2. compile        │ 4. usage payment    │ 5. bond tx
        ▼                   ▼                     ▼
┌──────────────────┐  ┌──────────────┐  ┌────────────────────────────┐
│ Intent Compiler  │  │ pay.sh / MPP │  │ Solana Devnet             │
│ Cloud Run        │  │ charge/session│ │ BotBond Anchor Program     │
│ Gemini on Vertex │  └──────────────┘  │ PDA escrow + policy hash   │
│ AI + ADK         │                    └────────────────────────────┘
└───────┬──────────┘
        │ policy JSON
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ State & Observability                                               │
│ Firestore session state · Cloud Logging/Trace · optional BigQuery   │
└─────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Web App — Next.js / Antigravity + Claude                            │
│ Agent view · merchant dashboard · policy diff · live trace · tx links│
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 컴포넌트별 책임

### 3.1 Web App

**기술:** Next.js, TypeScript, Tailwind, shadcn/ui, Solana Wallet Adapter, SSE

**화면:**

1. `Access Lab`: 정상/위반 agent 실행 버튼과 양쪽 상태 비교
2. `Intent Contract`: 자연어 목적과 컴파일된 정책 diff
3. `Session Meter`: 호출, 사용료, refundable bond를 별도 게이지로 표시
4. `Decision Trace`: 허용·차단 이유와 reservation lifecycle
5. `Settlement Receipt`: pay.sh 결과, Solana transaction, 정책 해시

Web은 정책이나 정산을 직접 판단하지 않는다. Gateway의 event stream을 렌더링한다.

### 3.2 Agent Access Gateway

**기술:** Node.js 22, Fastify, TypeScript, pay.sh TypeScript SDK, Firestore

**책임:**

- discovery document 제공
- intent-agent 호출
- 정책 JSON Schema 검증
- canonical JSON과 SHA-256 policy hash 생성
- pay.sh challenge/verification adapter
- Solana bond 상태 확인
- 짧은 수명의 scoped session token 발급
- protected API reverse proxy
- endpoint, HTTP method, field, count, rate, expiry, spend 집행
- inventory reservation의 create/release/consume/expire 집행
- signed usage receipt 생성
- close/violate/expire 상태 전이
- SSE event stream

Gateway가 해킹되면 판정 신뢰가 깨지는 것은 MVP의 trust assumption이다. 발표에서 숨기지 않는다.

### 3.3 Intent Compiler

**기술:** Python 3.12, FastAPI, Google ADK, Gemini on Vertex AI, Pydantic

**입력:** 사용자 목적, merchant capability catalog, 사용자 budget

**출력:** `AccessPolicyDraft` JSON과 사람용 설명

**규칙:**

- 임의 endpoint를 생성하지 않고 merchant catalog에 있는 capability만 선택
- 필요한 최소 field만 선택
- 호출량·기간·비용은 merchant maximum을 초과하지 않음
- Pydantic 검증 실패 시 최대 2회 repair 후 실패 반환
- temperature를 낮추고 fixture 기반 eval로 회귀 검사
- runtime monetary decision을 하지 않음

### 3.4 pay.sh Adapter

**책임:**

- Gateway의 유료 세션 또는 호출에 pay.sh payment challenge 적용
- agent payment credential 검증
- 실제 청구액과 session cap 기록
- pay.sh SDK·프로토콜 세부사항을 Gateway domain logic에서 격리

**중요:** MPP capped session이 현재 SDK에서 원하는 방식으로 동작하는지 첫 48시간 안에 spike한다. 실패하면:

1. pay.sh fixed charge를 실제 보호 API 호출에 적용한다.
2. 호출 상한은 Gateway가 집행한다.
3. 발표에서 `MPP session`을 구현했다고 말하지 않고 `pay.sh pay-per-use + bounded session`이라고 정확히 표현한다.

### 3.5 Solana Program

**기술:** Rust, Anchor, SPL token, Solana devnet

**책임:**

- agent와 merchant, policy hash, expiry, bond amount, max penalty를 PDA에 고정
- SPL token bond 예치
- 예약 정상 해제·구매 시 agent 환불
- 객관적인 reservation expiry receipt에 따른 제한 정산
- 정책 상한을 넘는 penalty 거부
- 만료 후 안전한 reclaim 경로 제공

사용료는 pay.sh, 담보는 이 프로그램이 담당한다.

### 3.6 GCP

| 서비스 | 필수 여부 | 사용 이유 |
|---|---:|---|
| Vertex AI Gemini | 필수 | Intent Compiler |
| Cloud Run | 필수 | web, gateway, intent-agent 배포 |
| Firestore | 필수 | 세션 상태와 event index |
| Secret Manager | 필수 | service credentials와 devnet signer secret |
| Cloud Logging/Trace | 필수 | 실제 구동 근거와 장애 분석 |
| Artifact Registry | 권장 | 컨테이너 이미지 |
| Cloud Build 또는 GitHub Actions | 권장 | 배포 자동화 |
| Pub/Sub + BigQuery | 선택 | 분석 화면이 필요할 때만 추가 |

GCP 서비스 개수를 늘리는 것이 점수가 아니다. Vertex AI, Cloud Run, 로그가 실제 경로에 있어야 한다.

## 4. End-to-End sequence

```text
Agent -> Gateway: GET /.well-known/agent-access
Gateway -> Agent: capabilities + prices + bond rules

Agent -> Gateway: POST /v1/intents {task, budget}
Gateway -> Intent Compiler: compile(task, merchant_catalog)
Intent Compiler -> Gateway: AccessPolicyDraft
Gateway -> Gateway: validate + canonicalize + hash
Gateway -> Agent: policy + pay.sh terms + bond terms

Agent -> Gateway/pay.sh: open paid access/session
Agent -> Solana: open_bond(policy_hash, amount, max_penalty, expiry)
Agent -> Gateway: POST /v1/sessions {payment_proof, bond_account}
Gateway -> pay.sh: verify
Gateway -> Solana RPC: verify bond
Gateway -> Agent: scoped session token

Agent -> Gateway: paid data calls + optional bonded reservation
Gateway -> Policy Engine: allow/deny
Gateway -> Protected API: allowed calls only
Gateway -> Firestore/Event stream: usage + decision

Agent -> Gateway: release/consume reservation + close
Gateway -> Solana: settle/close with usage receipt
Solana -> Agent/Merchant: refund + bounded settlement
Gateway -> Web: final receipt + tx links
```

## 5. 상태 모델

```text
CREATED
  -> POLICY_READY
  -> PAYMENT_READY
       ├-> ACTIVE                 # read-only policy
       └-> BONDED -> ACTIVE       # bonded action이 있는 policy
                        ├-> CLOSED
                        ├-> VIOLATED
                        └-> EXPIRED
```

허용되지 않는 역방향 전이는 거부한다. Firestore update는 expected current state를 확인하는 transaction으로 처리한다.

## 6. 보안 경계와 위협 모델

| 위협 | MVP 대응 | 남는 한계 |
|---|---|---|
| LLM 과권한 정책 | capability allowlist + schema + max clamp | catalog 자체가 잘못되면 방지 못함 |
| Agent token 재사용 | session id, expiry, nonce, audience binding | 완전한 device identity 아님 |
| Gateway 임의 penalty | onchain max penalty + receipt hash | gateway attestation 신뢰 필요 |
| Merchant 악성 정책 | 정책 사전 표시·서명, bounded penalty | 정책 품질 시장 검증 필요 |
| Agent 우회 접근 | 데모 WAF/mock route에서 차단 | BotBond 자체는 WAF가 아님 |
| Replay transaction | PDA session nonce + settled flag | RPC 가용성 의존 |
| Secret 노출 | Secret Manager, log redaction | MVP signer는 production custody 아님 |

## 7. 배포 단위

```text
Cloud Run: botbond-web
Cloud Run: botbond-gateway
Cloud Run: botbond-intent-agent
Firestore: sessions, events, merchantPolicies
Solana: botbond program + demo SPL mint
```

프론트엔드와 gateway를 하나로 합치면 초기 속도는 빠르지만, 역할 병렬화를 위해 서비스는 분리한다. 로컬 개발은 Docker Compose가 아니라 각각의 dev command와 mock adapter로도 가능해야 한다.
