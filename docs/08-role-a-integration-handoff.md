# Role A Integration Handoff

## Stable inputs

### BotBondEvent schema

```text
packages/contracts/schemas/botbond-event.schema.json
```

Every event contains:

```ts
{
  eventId: string;
  sessionId: string;
  occurredAt: string;
  type: BotBondEventType;
  data: Record<string, unknown>;
  traceId: string;
}
```

Do not consume structured logs as UI state. Consume this event envelope only.

### Validated fixture timelines

```text
packages/contracts/fixtures/events-normal.json
packages/contracts/fixtures/events-denied.json
packages/contracts/fixtures/events-expired.json
packages/contracts/fixtures/golden-policy.json
packages/contracts/fixtures/golden-policy.sha256
packages/contracts/fixtures/merchant-catalog.json
packages/contracts/fixtures/receipt-normal.json
packages/contracts/fixtures/receipt-expired.json
packages/contracts/schemas/settlement-receipt.schema.json
```

Both event files pass the shared runtime event schema tests.

## Gateway endpoints

```text
GET  /openapi.json
GET  /.well-known/agent-access
GET  /v1/catalog
POST /v1/intents
POST /v1/payment-challenges
POST /v1/sessions
ANY  /v1/access/{sessionId}/*
POST /v1/sessions/{sessionId}/close
GET  /v1/sessions/{sessionId}/receipt
GET  /v1/sessions/{sessionId}/events
```

`close`, `receipt`, and `events` require:

```http
Authorization: Bearer <session token>
```

Session creation and close require `Idempotency-Key`.

### Live SSE

```http
GET /v1/sessions/{sessionId}/events
Authorization: Bearer <session token>
Accept: text/event-stream
```

Behavior:

1. Existing event history replays in `occurredAt` order.
2. Connection stays open.
3. New session events stream immediately.
4. Heartbeat: `: keep-alive` every 15 seconds.
5. Reconnect sends `Last-Event-ID`; Gateway resumes strictly after known ID and deduplicates replay/live overlap. Unknown/stale IDs replay available history.
6. Standard SSE `id`, `event`, and JSON `data` fields.

For one-shot JSON history:

```http
GET /v1/sessions/{sessionId}/events
Authorization: Bearer <session token>
Accept: application/json
```

## Fake evidence rules

Display visible development badge whenever either marker appears:

```text
FAKE_COMPILER_FIXTURE
FAKE_ADAPTER_FIXTURE
```

Never create Explorer links from fake provider references.

The current HMAC payment credential bridge is a fixture even when the bond adapter uses real Solana. Payment events and challenges therefore retain `FAKE_ADAPTER_FIXTURE`; a real Solana provider reference may still be Explorer-eligible on its own.

## Expected UI states

- Intent received
- Policy compiled
- Payment verified
- Bond opened
- Session activated
- Request allowed
- Request denied with `penaltyAtomic: "0"`
- Reservation created/released/consumed/expired
- Usage settled
- Bond refunded
- Bounded penalty settled
- Session closed

Expiration terminal ordering is stable:

```text
RESERVATION_EXPIRED → PENALTY_SETTLED → USAGE_SETTLED
```

## Copy-paste local flow

```bash
BASE=http://127.0.0.1:8080

curl -sS "$BASE/.well-known/agent-access"
curl -sS "$BASE/v1/catalog"

curl -sS -X POST "$BASE/v1/intents" \
  -H 'content-type: application/json' \
  -d '{"agentWallet":"DemoAgentWallet1111111111111111111111111111","task":"Compare 20 laptops and reserve the best one for 60 seconds","budget":{"usageCapAtomic":"200000","bondCapAtomic":"1000000"}}'

# Copy intentId and policyHash from response.
curl -sS -X POST "$BASE/v1/sessions" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: role-a-session-1' \
  -d '{"intentId":"<intentId>","policyHash":"<policyHash>","paymentCredential":"fake-payment-ok","bondAccount":"fake-bond-ok"}'

# Copy sessionId and token.
curl -N "$BASE/v1/sessions/<sessionId>/events" \
  -H 'accept: text/event-stream' \
  -H 'authorization: Bearer <token>'

curl -sS "$BASE/v1/access/<sessionId>/seller-contacts" \
  -H 'authorization: Bearer <token>'
```

## Verification

```bash
npm ci
npm test
npm run e2e
```

Role A integration should validate every received event against shared schema during development.
