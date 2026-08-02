# BotBond Integration Test Matrix

## Shared contracts

| Check | Command | Expected |
|---|---|---|
| AccessPolicy JSON Schema | `npm test --workspace @botbond/contracts` | pass |
| Catalog allowlist/maxima | same | pass |
| Golden canonical hash | same + Python pytest | exact shared hash |
| Role A event fixtures | same | every event validates |
| Role C adapter harness | same | payment/bond conservation checks pass |

## Intent Compiler

| Check | Evidence |
|---|---|
| Four intent evals | `services/intent-agent/tests/test_compiler.py` |
| External operation rejected | invalid output after repair attempts |
| Merchant/user caps clamped | validation metadata clamp list |
| Fake marker | `FAKE_COMPILER_FIXTURE` |
| Vertex boundary | no live credentials tested yet |

## Gateway

| Check | Evidence |
|---|---|
| Payment failure blocks ACTIVE | Gateway test |
| Read-only skips bond | Gateway test |
| Bond required for reservation | Gateway test |
| Forbidden upstream unreachable | handler call count remains zero |
| Denied request penalty zero | event assertion |
| Token required for close/receipt/events | Gateway test |
| Reservation ownership | cross-session test |
| Release/expiry restore inventory | Gateway tests |
| Duplicate expiry invariant | call counters unchanged |
| Live SSE hub | event-stream tests |
| SSE reconnect/dedup | `Last-Event-ID` unit test + replay/live dedupe implementation |
| Log redaction | Gateway test |

## Firestore

| Check | Command |
|---|---|
| Round trip | emulator suite |
| Event ordering | emulator suite |
| Expected-state transaction | emulator suite |
| Invalid previous state rejected | emulator suite |
| Idempotency write-once | emulator suite |

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
npx firebase-tools emulators:exec --only firestore --project botbond-test \
  "npm run test --workspace @botbond/gateway -- --run test/firestore-repository.test.ts"
```

## Full local E2E

```bash
npm run e2e
```

Covers normal release/close, forbidden denial, abandoned expiry, events, and receipts using visibly fake adapters.

Cross-service compiler:

```bash
INTENT_COMPILER_PROVIDER=fake .venv/bin/uvicorn app.main:app \
  --app-dir services/intent-agent --host 127.0.0.1 --port 8081

INTENT_COMPILER_URL=http://127.0.0.1:8081 npm run e2e
```

## Remaining external gates

- Vertex live eval
- pay.sh live contract harness
- Solana devnet contract harness
- Cloud Run staging smoke test
- Firestore staging concurrency test
- Docker image build
