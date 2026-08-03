# BotBond Integration Test Matrix

## Local verification

```bash
npm install
npm run verify:all
```

`npm run verify:all` runs deterministic local verification, including combined Role A/B/C tests and local Solana validator tests. `npm run verify` runs everything except on-chain tests: type checks, Node/Python/chain-free Role C tests, Firestore emulator tests, production builds, and gateway/UI E2E. Python 3.12+ is required; `scripts/test-python.sh` creates `.venv` and installs test dependencies when needed. Java 21+ is required for the Firestore emulator; `scripts/test-firestore.sh` discovers `JAVA_HOME` on macOS and Homebrew.

`npm run verify:onchain` builds and deploys the Solana program to a local validator, then runs all on-chain Role C tests. It requires `anchor`, `solana`, `cargo-build-sbf`, and Rustup-managed Cargo. On macOS:

```bash
brew install anchor solana rustup
PATH="$(brew --prefix rustup)/bin:$PATH" cargo install cargo-build-sbf --locked
```

The script creates `~/.config/solana/id.json` when missing. This wallet is local-test only and needs no SOL.

## External verification

```bash
npm run verify:external
```

External verification targets Solana devnet and is intentionally separate from deterministic local verification. It requires a funded wallet, network access, and deployed-program authority. Vertex AI, pay.sh live, Cloud Run staging, and Firestore staging tests likewise require project-specific credentials and are not silently skipped by local commands.

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
| Payment failure blocks ACTIVE | Gateway test; failed pre-activation records are conditionally removed and client-generated session IDs retry successfully |
| Runtime request schema | malformed intent/session returns `INVALID_REQUEST` 400 before repository writes; OpenAPI includes intent/challenge/session request bodies |
| Read-only skips bond | Gateway test |
| Bond required for reservation | Gateway test |
| Forbidden upstream unreachable | handler call count remains zero |
| Denied request penalty zero | event assertion |
| Token required for close/receipt/events | Gateway test |
| Reservation ownership | cross-session test |
| Release/expiry restore inventory | Gateway tests |
| Duplicate expiry invariant | call counters unchanged |
| Live SSE hub | event-stream tests |
| SSE reconnect/dedup | direct web tests cover bearer auth, `Last-Event-ID`, heartbeat comments, split CRLF frames, and unauthorized failure; gateway tests cover replay/live dedupe |
| Role A/B payload compatibility | web reducer tests: canonical aliases, phase inference, usage accumulation, wall-clock TTL |
| Real payment bridge | session-bound `CappedSessionPaymentAdapter`, unit price `1000`, gateway activation test |
| Solana runtime factory | `ADAPTER_MODE=solana` fail-closed env tests + local-validator adapter contract |
| Settlement confirmation | PENDING polling unit tests + on-chain status-envelope tests |
| Settlement mutual exclusion | repository expected-state lock prevents close/expiry/request races; retryable failures unlock |
| Settlement evidence | canonical payload hash recomputation + HMAC + request field binding; restart recovery checks on-chain policy/receipt |
| Settlement attempt journal | stable close/expiry IDs, atomic first-evidence creation, monotonic provider/terminal status updates, Firestore concurrent-create/update coverage |
| Crash recovery boundary | 30-second durable settlement lease; expired `SETTLING` close/expiry reuses stable attempt evidence; bond account reference supports on-chain recovery; scheduled chain/database reconciliation remains production hardening |
| Compiled runtime | `npm run smoke:runtime --workspace @botbond/gateway` loads the packaged IDL and exercises discovery from `dist` |
| Expiry event order | Gateway and worker emit `RESERVATION_EXPIRED → PENALTY_SETTLED → USAGE_SETTLED`, matching Role A fixture lifecycle |

## Firestore

| Check | Command |
|---|---|
| Round trip | emulator suite |
| Event ordering | emulator suite |
| Expected-state transaction | emulator suite |
| Invalid previous state rejected | emulator suite |
| Idempotency write-once | emulator suite |
| Pre-activation rollback | session and initial events deleted transactionally only in allowed states |
| Settlement identity | concurrent first-write preserves one evidence hash and timestamp |
| Settlement nonce replay | same nonce + same evidence is idempotent; same nonce + different evidence is rejected across Firestore instances |
| Settlement journal monotonicity | concurrent update cannot regress `CONFIRMED` or erase provider reference |
| Settlement lease | concurrent claim has one winner; expired `SETTLING` lease can be reclaimed |

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

Covers normal release/close, forbidden denial, abandoned expiry, authenticated events, and receipts. Gateway lifecycle runs with fake bond in chain-free verification and with `SolanaBondAdapter` in local-validator verification; both use Role C payment semantics and Role A reducer assertions.

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
