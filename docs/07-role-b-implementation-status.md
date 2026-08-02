# Role B Implementation Status

## Implemented

Claim: Shared policy, catalog, event, adapter, reservation, session, and receipt contracts are executable in TypeScript and Python.  
Evidence: `packages/contracts/`, `services/intent-agent/app/models.py`, shared fixture `packages/contracts/fixtures/golden-policy.json`.  
Limit: Additive supporting fields are accepted for Role B integration baseline in `docs/contract-change-requests/CCR-001-executable-backend-supporting-types.md`; team-wide source-of-truth merge remains.

Claim: Natural-language intent compiles into catalog-limited, clamped policy through deterministic fake mode or Vertex AI provider boundary.  
Evidence: `services/intent-agent/app/`; Python eval and provider tests.  
Limit: Vertex AI path has not used live credentials. Google ADK was not added because one structured model call needs no agent runtime; provider boundary uses Vertex SDK directly.

Claim: Gateway negotiates paid/bonded scoped sessions and enforces method, path, response fields, call count, rate, expiry, usage cap, bond confirmation, and reservation count.  
Evidence: `apps/gateway/src/app.ts`; Gateway tests and fake E2E script. Firestore implementation plus 5 emulator tests cover persistence, event ordering, expected-state transitions, fingerprint-bound idempotency, concurrent request counters, durable inventory, and one-active-reservation enforcement in `apps/gateway/src/firestore-repository.ts`.  
Limit: staging GCP Firestore database and multi-instance concurrency/load remain unverified.

Claim: Demo commerce reservation lifecycle is deterministic and test-clock controlled.  
Evidence: `apps/gateway/src/commerce.ts`, release/expiry tests.  
Limit: demo data only; no external upstream proxy.

Claim: Events use shared envelope, propagate trace IDs, support authenticated live SSE with `Last-Event-ID` replay/deduplication, and redact sensitive keys.  
Evidence: `packages/observability/src/index.ts`; `apps/gateway/src/event-stream.ts`; `/v1/sessions/:sessionId/events`; validation/redaction/event-hub tests.  
Limit: live SSE fan-out is process-local; cross-instance delivery needs Firestore snapshot listener or Pub/Sub. Session bearer token gates events, receipts, and close; broader production identity/IAM remains deferred.

## Verified with evidence

Claim: TypeScript canonical policy hash matches expected fixture.  
Evidence: `sha256:120cece73bb7e5229db531c96d82b9d210a419ac9a901a34ccf72b136d346feb`; `npm test`.  
Limit: Rust client parity belongs to Role C.

Claim: Local vertical slice covers intent → hash → fake payment/bond → protected calls → release/expiry → events/receipt.  
Evidence: `npm run e2e`; cross-service run with `INTENT_COMPILER_URL=http://127.0.0.1:18081 npm run e2e` passed against live local FastAPI fake compiler. Expiry receipt includes usage settlement plus bounded bond settlement.  
Limit: all provider/chain evidence visibly fake.

Claim: Required backend invariants have automated tests.  
Evidence: 23 Gateway/in-memory tests pass, 5 Firestore emulator tests pass, 9 TypeScript contract/adapter-harness tests pass, and 10 Python tests pass; includes reservation ownership, scoped close/receipt/events, SSE reconnect filtering, signed settlement evidence, hostile-adapter runtime settlement amount/conservation validation, background expiry processor, duplicate-expiry invariance, exact request-count usage charging, failure-path idempotency release, fingerprint-bound idempotency claims, concurrent request counters, durable inventory/one-active-reservation transactions, state, redaction, adapter conservation, fixture/receipt validation, and shared hash checks.  
Limit: staging concurrency/load tests and live providers remain.

## Still fake or unverified

Claim: Payment and bond integrations are isolated behind stable interfaces.  
Evidence: `PaymentAdapter`, `BondAdapter`, `FakePaymentAdapter`, `FakeBondAdapter`.  
Limit: pay.sh behavior, Solana confirmations, transaction status shapes, retries, and devnet results are unverified.

Claim: GCP boundaries are ready for later deployment work.  
Evidence: Fastify/FastAPI Dockerfiles, env configuration, Cloud Run-compatible ports, and built Gateway OpenAPI runtime smoke test (`GET /openapi.json` returned 200).  
Limit: no Cloud Run revision deployed. Docker CLI was unavailable locally (`No such file or directory`), so container image builds remain unverified. Requested gate keeps deployment after local acceptance.

## Contract changes requested

Claim: Required additive implementation types are documented rather than silently inserted into product docs.  
Evidence: `docs/contract-change-requests/CCR-001-executable-backend-supporting-types.md`, accepted for Role B integration baseline on 2026-08-02.  
Limit: team-wide cross-role acknowledgement and source-of-truth merge into `docs/03-contracts.md` remain.

## Integration input needed from Role A

Claim: Role A can build without backend internals.  
Evidence: validated fixtures `packages/contracts/fixtures/events-normal.json` and `events-expired.json`, shared schema, authenticated live SSE, and `docs/08-role-a-integration-handoff.md`.  
Limit: cross-instance SSE fan-out remains pending.

## Integration input needed from Role C

Claim: Gateway integration point is narrow and independently testable.  
Evidence: interfaces and reusable harness in `packages/contracts/src/adapter-contract.ts`; exact handoff in `docs/09-role-c-integration-handoff.md`.  
Limit: Need real PaymentAdapter and BondAdapter, provider status/error mapping, confirmation finality rules, stable transaction result, actual pay.sh supported mode, Solana program ID/network, and live contract-test evidence.

## Commands to run locally

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run e2e

JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
  npx firebase-tools emulators:exec --only firestore --project botbond-test \
  "npm run test --workspace @botbond/gateway -- --run test/firestore-repository.test.ts"

npm run process-expirations --workspace @botbond/gateway

python3.12 -m venv .venv
.venv/bin/pip install -e 'services/intent-agent[test]'
.venv/bin/pytest services/intent-agent
INTENT_COMPILER_PROVIDER=fake .venv/bin/uvicorn app.main:app --app-dir services/intent-agent --port 8081
INTENT_COMPILER_URL=http://localhost:8081 ADAPTER_MODE=fake npm run dev --workspace @botbond/gateway
```

## Known risks

Claim: Slice intentionally favors truthful local execution over infrastructure breadth.  
Evidence: no Pub/Sub, BigQuery, production auth, or generalized multi-merchant layer.  
Limit: Memory mode remains process-local and non-transactional; Firestore mode provides transactional expected-state transitions but full multi-record session/reservation/settlement atomicity still needs staging hardening. Tokens are opaque random bearer values stored as hashes, not signed cross-instance tokens. Reservation expiration has both deterministic endpoint and batch processor; production scheduling still needs Cloud Scheduler/Run Job authorization.
