# Role B Implementation Status

## Integrated and verified

- **Claim:** Shared policy, catalog, event, adapter, reservation, session, and receipt contracts execute across TypeScript, Python, gateway, web reducer, and Solana client.
  - **Evidence:** `packages/contracts/`, `services/intent-agent/`, `packages/payment-client/`, shared golden policy fixture.
  - **Limit:** External providers still require credential-gated verification.

- **Claim:** Intent compilation is catalog-limited and cap-clamped in deterministic fake mode, with Vertex AI behind provider boundary.
  - **Evidence:** Intent-agent tests and compiler validation metadata.
  - **Limit:** Vertex AI live credentials not tested.

- **Claim:** Gateway negotiates session-bound payment, verifies policy-bound Solana bond, enforces scoped access, tracks usage at shared unit price `1000`, and settles release/expiry outcomes.
  - **Evidence:** `apps/gateway/src/app.ts`, `apps/gateway/src/adapters.ts`, gateway tests, Role C adapter tests, combined local-validator A/B/C E2E.
  - **Limit:** pay.sh live credential issuance remains external; local `issueCredential()` is test-only and not exposed by gateway.

- **Claim:** Payment challenge is public without exposing a credential minting helper.
  - **Evidence:** `POST /v1/payment-challenges` binds client-generated session ID and policy usage cap. The discovery and challenge response identify the current HMAC credential bridge with `FAKE_ADAPTER_FIXTURE`.
  - **Limit:** Production pay.sh payment rail must return the credential consumed by `POST /v1/sessions`; sandbox x402 evidence is not the same as live Gateway verification.

- **Claim:** Compiled Gateway output is executable and request validation is represented in OpenAPI.
  - **Evidence:** `npm run smoke:runtime --workspace @botbond/gateway` loads the tracked `@botbond/payment-client/idl/botbond.json` asset from `dist`, starts Fastify in-process, and receives discovery 200. Intent, payment-challenge, and session bodies use Fastify JSON Schema; malformed negotiation requests return `INVALID_REQUEST` 400.
  - **Limit:** Docker image build and Cloud Run container startup remain external gates because Docker CLI is unavailable locally.

- **Claim:** Failed session creation is retry-safe before activation.
  - **Evidence:** Atomic `createSession`, transactional pre-activation session/event delete, idempotency release, client-generated session retry test, Firestore emulator coverage.
  - **Limit:** Process death before request-level rollback can leave a pre-activation record until retry/cleanup tooling handles it.

- **Claim:** Request accounting and settlement are concurrency guarded, recover stale locks, and preserve settlement identity across retries.
  - **Evidence:** `ACTIVE → SETTLING → CLOSED|EXPIRED`, 30-second durable settlement lease, expired-lease reclaim, failure rollback to ACTIVE, transaction-level expected-state check in `reserveRequest`, stable settlement-attempt IDs, atomic first-evidence creation, monotonic provider/terminal journal updates, close/expiry mutual exclusion and recovery tests.
  - **Limit:** Full chain/database reconciliation still requires scheduled execution and operational alerting in production.

- **Claim:** Solana settlement survives adapter cache loss and validates evidence strongly.
  - **Evidence:** Persistent `bondReference`, on-chain policy/amount/receipt comparison, canonical evidence-hash recomputation, HMAC verification, request field binding, durable gateway attempt evidence, Firestore nonce claims across repository instances, and local-validator restart tests.
  - **Limit:** The adapter's own nonce cache is process-local, but the Gateway repository rejects cross-instance replay durably. Scheduled chain/database reconciliation remains a production gate.

- **Claim:** Events use shared envelope and feed Role A through authenticated SSE.
  - **Evidence:** Bearer auth, `Last-Event-ID`, 15-second heartbeat, gateway replay/live dedupe, direct web stream tests for split frames/heartbeat/auth, reducer compatibility tests.
  - **Limit:** Live fan-out remains process-local; cross-instance delivery needs Firestore listener or Pub/Sub.

- **Claim:** Demo commerce reservation lifecycle is deterministic and inventory-safe.
  - **Evidence:** Transactional Firestore inventory/reservation operations, one-active-reservation enforcement, release/expiry tests, background expiry processor. Terminal expiry events are ordered `RESERVATION_EXPIRED → PENALTY_SETTLED → USAGE_SETTLED` for Role A parity.
  - **Limit:** Demo commerce only; no real merchant upstream.

- **Claim:** The recorded demo uses the same two deterministic SKUs as the Gateway commerce API and foregrounds merchant outcomes rather than raw event volume.
  - **Evidence:** `packages/demo-fixtures/generate.py`, `apps/web/public/fixtures/`, and `docs/13-demo-scenario-runbook.md` use `lap-1` / `lap-2`, including the last-unit `1 → 0 → 1` expiry path.
  - **Limit:** The fixtures remain visibly marked as development evidence; the live SSE view has no fixture narration.

## Verification commands

```bash
npm ci
npm run verify          # deterministic non-chain suite
npm run verify:onchain  # local validator + Role C + combined A/B/C E2E
npm run verify:external # credential/funded-wallet external gates
```

Requirements: Node 22+, Python 3.12+, Java 21+, Anchor/Solana/Rustup/cargo-build-sbf for on-chain suite. Docker CLI was unavailable during local verification, so image build remains an explicit gate.

## Remaining production gates

- pay.sh live credential/challenge contract and settlement behavior
- scheduled chain/database reconciliation and alerting
- Firestore staging multi-instance concurrency/load
- cross-instance SSE fan-out
- Vertex AI live eval
- Solana devnet run with funded wallet and deployed authority
- Cloud Run staging smoke and Docker image build

## Security decisions

- `BOTBOND_PAYMENT_SECRET` and `BOTBOND_EVIDENCE_SECRET` are required in `ADAPTER_MODE=solana` and fail closed.
- Real secret values are never committed. Test-only values are injected by tests/local scripts.
- Deterministic local verification stays separate from funded-wallet or external-credential verification.
- No production fallback secret is permitted.
