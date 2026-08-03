# BotBond — Bonded Agent Access

BotBond는 사이트가 처음 보는 AI 에이전트에게도 **서명된 사용 목적, 사용량 상한, 환불 가능한 보증금**을 기반으로 제한된 API 세션을 발급하는 agent-access gateway다.

> Unknown agents do not need instant trust. They need bounded access and enforceable accountability.

## 이번 해커톤에서 증명할 것

1. 에이전트가 자연어로 작업 목적을 제시한다.
2. Gemini가 목적을 기계 집행 가능한 정책으로 컴파일한다.
3. 에이전트가 사람의 추가 승인 없이 pay.sh x402 sandbox 호출을 결제하고 Solana devnet 보증금을 연다.
4. 일반 데이터 호출은 pay.sh의 per-call rail을 통과하고, 재고 예약처럼 merchant 비용을 발생시키는 행동은 별도 Solana bond로 담보된다.
5. 범위 밖 호출은 결정론적으로 차단하되 그것만으로 bond를 차감하지 않는다. 실제 예약을 방치하는 등 서명된 객관적 의무를 어겼을 때만 제한 정산한다.
6. pay.sh의 `402 → sandbox pay → 200` 결과와 Solana의 bond open·refund·bounded settlement를 각각 확인한다.

## 이번에 주장하지 않을 것

- Cloudflare·WAF를 우회한다.
- 악성 봇을 BotBond만으로 차단한다.
- 임의의 웹사이트나 CAPTCHA를 열어준다.
- LLM이 단독으로 보증금을 몰수한다.
- 온체인 평판이 Sybil 공격을 해결한다.
- pay.sh가 보증금·슬래싱까지 기본 제공한다.

## Live demo

- BShop product demo: https://botbond-bshop.vercel.app
- Cloud Run Web fallback: https://botbond-web-752329931962.us-central1.run.app
- Agent discovery: https://botbond-gateway-752329931962.us-central1.run.app/.well-known/agent-access
- Hosted pay.sh x402 sandbox gate: https://botbond-pay-gate-752329931962.us-central1.run.app
- Solana program: https://explorer.solana.com/address/HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc?cluster=devnet
- Latest verified run: [docs/15-live-deployment-evidence.md](docs/15-live-deployment-evidence.md)

The public Web app can now start a sponsored live devnet run. Each accepted run creates a fresh bond-open transaction and a fresh refund or bounded-settlement transaction. The runner is IP-hash cooldown, daily-budget, and single-concurrency limited. Recorded examples remain available only as clearly separated fallback evidence. Secrets and scoped session tokens are never committed.

## Reproduce locally

Requirements: Node.js 22+, Python 3.12+, Java 21, Firebase CLI, Rust, Solana CLI, and Anchor.

```bash
npm install
npm run verify
```

`npm run verify` runs TypeScript, Python, Anchor contract, Firestore emulator, production build, runtime smoke, and fake-adapter E2E checks. Real devnet execution additionally needs a funded Solana devnet wallet and the secrets described in [infra/README.md](infra/README.md).

To run the connected live path after configuring those secrets:

```bash
GOOGLE_CLOUD_PROJECT=botbond-demo-2026-jaeman \
BOTBOND_PAYMENT_SECRET=<secret> \
BOTBOND_EVIDENCE_SECRET=<secret> \
npm run demo:live
```

The command creates a new policy with Vertex AI, opens a new Solana devnet bond, exercises allowed and denied Gateway calls, waits for the real reservation TTL, restores inventory, and performs bounded settlement. It writes the private live URL to `.secrets/live-demo-session.json`; that file is gitignored.

Payment claim boundary: the hosted pay.sh gate performs a real x402 sandbox `402 → payment → scoped API response` flow. The Gateway still activates the surrounding BotBond session through an HMAC adapter marked `FAKE_ADAPTER_FIXTURE`; it must not be described as live pay.sh session-credential verification or an MPP capped session.

External developers can run the complete flow with their own devnet wallet and no BotBond server secret. See [Bring your agent](docs/16-bring-your-agent.md) or run:

```bash
npm run example:external-agent -- \
  --gateway https://botbond-gateway-752329931962.us-central1.run.app \
  --wallet ~/.config/solana/id.json
```

The Vercel demo is organized as four product surfaces rather than a presentation rail:

- `Shop`: ordinary product browsing and human checkout
- `Agent API`: unknown-client `403`, official discovery, bounded access, and agent behavior
- `Merchant Ops`: shared inventory, allowed/denied requests, expiry, penalty, and refund
- `Integrate`: discovery, public endpoints, and the external-agent command

## 문서 읽는 순서

1. [제품 명세](docs/01-product-spec.md)
2. [기술 아키텍처](docs/02-architecture.md)
3. [인터페이스와 온체인 계약](docs/03-contracts.md)
4. [데모 및 검증 계획](docs/04-demo-validation.md)
5. [3인 역할과 협업 방식](docs/05-team-plan.md)
6. [Claude/Antigravity 역할별 시작 프롬프트](docs/06-claude-kickoff-prompts.md)
7. [결정 로그](docs/00-decision-log.md)
8. [제출 소개서·데모 영상·재현 가이드](docs/14-team-demo-and-pitch-flow.md)
9. [라이브 배포 및 온체인 증거](docs/15-live-deployment-evidence.md)
10. [외부 에이전트 공개 연동](docs/16-bring-your-agent.md)
11. [소개서·3분 영상 보완안](docs/17-deck-and-video-delta.md)

## 권장 저장소 구조

```text
botbond/
├── apps/
│   ├── web/                 # Next.js 데모·운영자 대시보드
│   └── gateway/             # Agent Access Gateway + pay.sh adapter
├── services/
│   └── intent-agent/        # Gemini/ADK Intent Compiler
├── programs/
│   └── botbond/             # Solana Anchor 프로그램
├── packages/
│   ├── contracts/           # JSON Schema, TS/Python 생성 타입
│   ├── demo-fixtures/       # 고정 상품·정상/위반 시나리오
│   └── observability/       # 이벤트와 trace 공통 코드
├── infra/                   # GCP 배포 설정
├── docs/
└── scripts/                 # demo reset, smoke test, seed
```

## Definition of Done

라이브 데모에서 하나의 버튼 또는 명령으로 다음이 3분 내 실행돼야 한다.

- Intent 컴파일
- pay.sh x402 sandbox의 실제 유료 호출
- Solana devnet 보증금 예치
- 정상 세션의 사용료 정산·예약 해제·bond 반환
- 범위 위반 호출 차단과 예약 방치 세션의 제한 정산
- 트랜잭션 해시, 정책 해시, 호출 로그 확인
