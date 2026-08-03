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

## Live product and evidence

- BShop product demo: https://botbond-bshop.vercel.app
- Cloud Run Web fallback: https://botbond-web-752329931962.us-central1.run.app
- Agent discovery: https://botbond-gateway-752329931962.us-central1.run.app/.well-known/agent-access
- Hosted pay.sh x402 sandbox gate: https://botbond-pay-gate-752329931962.us-central1.run.app
- Solana program: https://explorer.solana.com/address/EG9rKPV69v3WNX7aVchAPonMtKPp6yML7jZwDjMKaRKR?cluster=devnet
- Latest verified run: [docs/15-live-deployment-evidence.md](docs/15-live-deployment-evidence.md)

The public Web app has four independent product routes:

| Route | Who uses it | What is actually testable |
|---|---|---|
| [`/shop`](https://botbond-bshop.vercel.app/shop) | customer | normal storefront and human checkout path |
| [`/agent`](https://botbond-bshop.vercel.app/agent) | unknown agent | deployed direct `403`, discovery, sponsored Solana-devnet run |
| [`/merchant`](https://botbond-bshop.vercel.app/merchant) | BShop operator | inventory, scoped requests and settlement evidence |
| [`/integrate`](https://botbond-bshop.vercel.app/integrate) | agent developer | live connection check: discovery `200`, direct `403`, pay.sh gate `402`, own-wallet command |

The sponsored browser runner creates fresh Solana-devnet bond-open and refund or bounded-settlement transactions. It has a 1-minute IP-hash cooldown, daily budget, and single-concurrency limit. It never exposes a scoped token or signer secret.

### Honest execution boundary

| Component | Current state | What can be claimed |
|---|---|---|
| Vertex AI Gemini, Cloud Run, Firestore | live | intent compilation, sessions and ordered evidence |
| BotBond Anchor program | live on Solana devnet | reproducible bond open and settlement/refund transactions |
| BShop direct route | live Gateway policy | unscoped `GET /products → 403` and discovery link |
| pay.sh rail | hosted sandbox | per-call `402 → sandbox payment → scoped 200` from external-agent CLI |
| browser session credential | HMAC demo bridge | live devnet bond only; **not** pay.sh session verification |
| Cloudflare | not integrated | BShop reproduces an equivalent direct-rejection policy; it does not bypass a Cloudflare zone |

The Solana asset is a devnet test mint, **not USDC**. MPP capped repeated-call sessions are not claimed as E2E implemented.

## Reproduce locally

Requirements: Node.js 22+, Python 3.12+, Java 21, Firebase CLI, Rust, Solana CLI, and Anchor.

```bash
npm install
npm run verify
```

`npm run verify` runs type checks, unit tests, Firestore emulator checks, production build, runtime smoke, and fake-adapter E2E. It does not prove a live chain transaction; live evidence is documented separately.

To run the connected live path after configuring those secrets:

```bash
GOOGLE_CLOUD_PROJECT=botbond-demo-2026-jaeman \
BOTBOND_PAYMENT_SECRET=<secret> \
BOTBOND_EVIDENCE_SECRET=<secret> \
npm run demo:live
```

The command creates a new policy with Vertex AI, opens a new Solana devnet bond, exercises allowed and denied Gateway calls, waits for the real reservation TTL, restores inventory, and performs bounded settlement. It writes the private live URL to `.secrets/live-demo-session.json`; that file is gitignored. This operator run uses the gateway's configured payment bridge; it is not pay.sh session verification.

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

## 3-minute filming flow

Do not edit different runs to look like one payment rail. The video has two explicitly labelled proof segments because the browser session and pay.sh sandbox have different real boundaries.

| Time | Screen / command | Evidence to capture | What to say |
|---:|---|---|---|
| 0:00–0:15 | `/shop` then `/agent` | BShop is a normal customer storefront; agent path is separate | “BotBond is a merchant-installed agent lane, not a CAPTCHA bypass.” |
| 0:15–0:35 | `/agent` → **Send** direct request | real Gateway `403 UNKNOWN_AUTOMATED_CLIENT` and discovery link | “Unknown automation stops before origin, but the merchant publishes an official route.” |
| 0:35–0:55 | `/integrate` → **Run connection check** | discovery `200`, direct `403`, hosted pay.sh gate `402` plus trace IDs | “These are three live HTTP outcomes. `402` is a challenge, not a browser payment.” |
| 0:55–1:35 | `/agent` → choose a behavior → **Run fresh Solana devnet session** | new policy/session, live events, a fresh Explorer bond-open link | “Gemini proposes scope; the Gateway enforces deterministic rules; this browser run has a live devnet bond.” |
| 1:35–2:05 | same run | allowed scoped `200`; private endpoint `403`; origin boundary | “A scope denial reveals no data and has penalty zero.” |
| 2:05–2:25 | complete or abandon selected behavior | refund or bounded settlement Explorer link and receipt | “Only objective bonded actions settle. The token is devnet test token, not USDC.” |
| 2:25–3:00 | terminal, own wallet | `npm run example:external-agent -- ...`, showing pay.sh sandbox `402 → payment → 200` and the two Explorer links | “This separate own-wallet CLI run is the actual pay.sh sandbox payment proof. It is not presented as the browser run.” |

For a bounded-settlement take, choose **Abandon last-unit hold** before the sponsored run. It intentionally waits for the configured TTL. For a shorter normal take, choose **Complete purchase**. Save the generated session ID, policy hash, receipt hash, bond-open signature and settlement/refund signature with the video; use the same identifiers in the submitted evidence.

### Architecture and project-introduction PDF

[`botbond-deck-v2.pdf`](botbond-deck-v2.pdf) is the project-introduction deck. It covers target users, problem, Cloudflare boundary, the four product surfaces, request outcomes, architecture, technology truth table, demo flow and reproducibility. Its editable source is [`docs/botbond-deck-v2-marp.md`](docs/botbond-deck-v2-marp.md).

The architecture deliberately shows the two current execution paths:

```text
Sponsored browser agent ─ HMAC demo bridge ─┐
                                              ├─ BotBond Gateway (Cloud Run)
External own-wallet agent ─ pay.sh sandbox ──┘      ├─ Vertex AI Gemini
                                                     ├─ Firestore
                                                     ├─ BShop Origin API
                                                     └─ Solana devnet bond program
```

Only the external own-wallet path makes the pay.sh sandbox payment. Both paths can use the real devnet bond program; neither is a Cloudflare bypass.

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

## Submission checklist

- [x] 프로젝트 소개서 PDF: target, problem, installation scenario and architecture
- [x] reproducible repository: source, README and own-wallet CLI guide
- [x] live endpoints: web, discovery, Gateway and pay.sh sandbox gate
- [x] real Solana-devnet program: reproducible binary, open and refund evidence
- [ ] final 3-minute recording: record the two labelled proof segments above and retain the generated Explorer URLs
