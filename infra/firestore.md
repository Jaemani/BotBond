# Firebase / Firestore Local Validation

## Implemented

- `FirestoreRepository` for intents, sessions, events, reservations, and idempotency records.
- Expected-state transition uses Firestore transaction.
- Event queries return `occurredAt` order.
- Environment repository selection:

```text
REPOSITORY_MODE=memory      # default local/CI
REPOSITORY_MODE=firestore
GOOGLE_CLOUD_PROJECT=<project>
FIRESTORE_NAMESPACE=botbond
```

Firestore client automatically uses emulator when `FIRESTORE_EMULATOR_HOST` exists.

## Emulator test

Requires Java 21 and Firebase CLI.

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
npx firebase-tools emulators:exec \
  --only firestore \
  --project botbond-test \
  "npm run test --workspace @botbond/gateway -- --run test/firestore-repository.test.ts"
```

Validated behaviors:

- intent/session round trip
- event ordering
- expected-state transition transaction
- invalid prior state rejection
- write-once idempotency result

## Security posture

`firestore.rules` denies all client SDK access. Gateway uses server credentials/IAM. Do not expose these collections directly to browser clients.

## Production prerequisites

- Create Firestore database in chosen GCP project.
- Deploy `firestore.indexes.json`.
- Grant Gateway service account only required Firestore roles.
- Keep service credentials in Workload Identity/Secret Manager, not source or browser environment.
- Run emulator suite and staging E2E before Cloud Run traffic.
