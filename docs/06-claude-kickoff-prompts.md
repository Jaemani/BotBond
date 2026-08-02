# Claude / Antigravity Kickoff Prompts

아래 프롬프트는 역할을 정한 뒤 각 팀원이 첫 작업에 그대로 사용할 수 있는 시작점이다. 저장소 전체 구현을 한 번에 요청하지 말고, 첫 48시간의 기술 위험을 제거하는 데 사용한다.

## 공통 System Context

세 역할 프롬프트 앞에 다음을 붙인다.

```text
We are building BotBond for a Google Cloud × Solana Agentic Commerce hackathon.

Product boundary:
- BotBond is an operator-installed agent-access gateway, not a WAF bypass.
- pay.sh charges data/API usage.
- A separate Solana program holds a refundable bond only for costly or scarce actions such as inventory reservations.
- A blocked out-of-scope request is not slashable.
- Only an objectively expired reservation can trigger a bounded settlement.
- Gemini compiles natural-language intent into a machine-enforceable least-privilege policy. It never directly moves money.

Source of truth:
- README.md
- docs/01-product-spec.md
- docs/02-architecture.md
- docs/03-contracts.md

Rules:
- Work only inside the assigned directories.
- Do not silently change shared schemas.
- Do not invent pay.sh, MPP, Solana, or GCP behavior. Mark an adapter as unverified until a real spike proves it.
- Prefer a vertical slice that can be executed and tested over broad scaffolding.
- Every task must end with commands run, evidence produced, known limits, and the next integration input.
```

## 역할 A 시작 프롬프트 — Product Experience & Demo

```text
You own:
- apps/web/**
- packages/demo-fixtures/** only for UI fixtures
- docs owned by the Product Experience role

Goal for the first 48 hours:
Build a high-fidelity, deterministic demo shell using event fixtures before backend integration.

Required screens/states:
1. Unknown agent receives 403 and discovers the official agent-access route.
2. Natural-language intent appears next to the compiled signed policy.
3. Usage balance and refundable bond are visually distinct.
4. A normal agent pays for product/stock calls, creates one 60-second reservation, releases it, and receives the bond back.
5. A second agent attempts /seller-contacts and is blocked with zero bond penalty.
6. The second agent creates an allowed reservation but abandons it; expiry causes a bounded settlement and remainder refund.
7. Every payment/chain action has pending, confirmed, and failed states.

UX constraints:
- The main interface is not a chatbot.
- Make the transformation Intent → Contract → Access → Settlement visually dominant.
- Do not show fake hashes as if they were live. Fixture mode must have a visible DEV FIXTURE label.
- All state must be driven from BotBondEvent fixtures defined in docs/03-contracts.md.

Deliverables:
- Responsive Next.js page(s)
- A fixture event player with pause/reset/speed controls
- Component inventory and state matrix
- A 20-second comprehension test script
- Typecheck/lint/build commands and results

Stop condition:
If an event or data field is missing, write CCR-001 instead of changing the shared contract.
```

## 역할 B 시작 프롬프트 — Agent Intelligence & GCP Backend

```text
You own:
- apps/gateway/**
- services/intent-agent/**
- packages/contracts/**
- packages/observability/**
- infra/** for GCP services

Goal for the first 48 hours:
Prove the intent-to-policy path and a contract-valid session state machine without waiting for the real chain/payment adapter.

Build:
1. Merchant capability catalog for product search, inventory lookup, and one bonded reservation.
2. FastAPI Intent Compiler using Gemini structured output and Pydantic.
3. Three eval cases:
   - price/stock only
   - price/stock plus one reservation
   - an overbroad request asking for seller contacts, where forbidden access is excluded
4. Fastify Gateway skeleton with strict state transitions.
5. Policy canonicalization and SHA-256 hash library with golden fixtures.
6. Policy enforcement for path, method, fields, total calls, per-minute calls, expiry, and reservation count.
7. A protected demo commerce API with reservation create/release/consume/expire.
8. SSE BotBondEvent stream.
9. PaymentAdapter and BondAdapter interfaces plus clearly labelled fake implementations.

Safety invariants:
- Catalog-external endpoints cannot appear in a policy.
- Gemini output cannot directly activate a session or settle a bond.
- A denied request emits REQUEST_DENIED but no penalty event.
- A bonded action cannot execute until BondAdapter confirms the bond.
- Reservation expiry is deterministic and idempotent.

Deliverables:
- OpenAPI output
- Golden policy fixtures
- Unit/contract tests
- Local E2E script through fake adapters
- Cloud Run deployment plan, but do not spend time on production hardening yet
- Commands and test results

Stop condition:
If the shared policy schema cannot represent an invariant, write a CCR before editing it.
```

## 역할 C 시작 프롬프트 — Payment Protocol & Solana

```text
You own:
- programs/botbond/**
- payment adapter/client package assigned by the team
- devnet deployment scripts and protocol evidence

Goal for the first 48 hours:
Eliminate the two highest technical risks with minimal real transactions: pay.sh integration and Solana bond open/refund.

Track A — pay.sh spike:
1. Protect one test endpoint with an actual pay.sh payment flow.
2. Verify whether the current SDK supports the required capped repeated-call MPP session.
3. Record exact supported behavior and limitations.
4. Expose a narrow adapter interface to Gateway:
   - createChallenge
   - verifyCredential
   - getUsageSettlement
5. If MPP does not fit, implement a fixed-charge fallback and report the precise pitch wording change.

Track B — Solana spike:
1. Anchor program with BondSession PDA.
2. open_bond using a devnet test token/SPL mint agreed by the team.
3. close_valid returning the full bond.
4. settle_expired_reservation enforcing penalty <= max_penalty and refunding the remainder.
5. reclaim_expired after grace period.
6. Reject replay and double settlement.
7. TypeScript client returning stable transaction result objects for Gateway/UI.

Critical invariants:
- An out-of-scope HTTP attempt is not a chain penalty condition.
- The settlement authority cannot take more than max_penalty.
- The policy hash is immutable after open_bond.
- The same session cannot settle twice.
- Do not claim decentralized dispute resolution or production-grade custody.

Deliverables:
- Tests for open/refund/bounded settlement/reclaim/replay
- At least one real devnet open and refund transaction
- At least one real pay.sh payment
- IDL and client API
- Integration fixture for roles A and B
- A short VERIFIED / NOT VERIFIED capability table

Stop condition:
If current pay.sh documentation or SDK behavior differs from our contract, do not emulate it under the pay.sh name. Report the gap and implement the agreed fallback adapter.
```

## 첫 통합 회의 질문

세 역할이 48시간 후 다음만 가져온다.

### A

- event fixture로 정상·방치 시나리오가 모두 보이는가?
- usage와 bond가 시각적으로 구분되는가?

### B

- 같은 intent가 안정적인 policy를 만드는가?
- bonded action이 없으면 별도 bond를 요구하지 않는가?

### C

- pay.sh에서 실제 검증된 mode는 무엇인가?
- program이 정상 반환과 bounded settlement를 실제로 수행했는가?

세 답이 모두 Yes일 때만 P1 기능을 추가한다.

