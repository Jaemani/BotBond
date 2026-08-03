# Cloud Run + Firebase Deployment

Local E2E and contract tests are the deployment gate. `scripts/deploy-gcp.sh` builds and deploys the three runtime services after the project, billing, and secrets are available. A command existing in this repository is not deployment evidence; only returned Cloud Run revisions and URLs count.

## Services

- `botbond-intent-agent`: Python 3.12 FastAPI, `PORT`, optional Vertex AI provider.
- `botbond-gateway`: Node 22 Fastify, `PORT`, `INTENT_COMPILER_URL`, adapter mode.
- `botbond-web`: Next.js 15 standalone service, `PORT`, `BOTBOND_GATEWAY_URL`.

## Required production configuration

Gateway:

```text
ADAPTER_MODE=solana
REPOSITORY_MODE=firestore
FIRESTORE_NAMESPACE=botbond
INTENT_COMPILER_URL=https://<intent-service>
GOOGLE_CLOUD_PROJECT=<project>
```

Intent Compiler:

```text
INTENT_COMPILER_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=<project>
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=<approved Gemini model>
GEMINI_TEMPERATURE=0.1
```

Web:

```text
BOTBOND_GATEWAY_URL=https://<gateway-service>
```

The web service proxies `/gateway/*` to the configured Gateway and can render an
authenticated live session when opened with `sessionId` and `token` query parameters.
Without those parameters it is explicitly labelled `DEMO SIMULATION` and replays the
checked-in evidence fixtures; fixture transaction references never become Explorer links.

Do not deploy Gateway with `ADAPTER_MODE=fake` as live evidence. `ADAPTER_MODE=solana` enables the real bond adapter, but the current HMAC payment credential bridge remains visibly marked `FAKE_ADAPTER_FIXTURE` until a live pay.sh verification adapter replaces it.

## Minimum platform dependencies

1. Artifact Registry for three images.
2. Cloud Run for Web, Gateway, and Intent Compiler.
3. Vertex AI API for Intent Compiler.
4. Firestore repository and emulator contract are implemented; create database and deploy `firestore.indexes.json` before multi-instance staging. See `infra/firestore.md`.
5. Secret Manager for Role C credentials; never plain environment values in deploy scripts.
6. Cloud Logging/Trace through structured stdout and propagated `x-trace-id`.

## One-time operator approvals

- Google login for `gcloud`, Firebase CLI, and Antigravity CLI.
- A unique Firebase/GCP project ID and billing-account attachment.
- At least 2 devnet SOL in the project settlement wallet.
- Firebase project activation (`firebase projects:addfirebase`) after the GCP project exists.

The deployment script creates the Artifact Registry repository, Firestore database, least-purpose runtime service accounts, images, and Cloud Run services. It intentionally stops if these Secret Manager entries do not exist:

```text
botbond-devnet-wallet
botbond-evidence-secret
botbond-payment-secret
```

The wallet secret is mounted as a file; HMAC secrets are injected as environment-backed secrets. No private key belongs in Git, Cloud Build substitutions, or plain Cloud Run environment values.

## Deploy

```bash
scripts/deploy-gcp.sh <project-id> us-central1
firebase use <project-id>
firebase deploy --only firestore:rules,firestore:indexes
```

Set `GEMINI_MODEL` before the deploy command only if the project supports a different approved Vertex model. The default is `gemini-2.5-flash`.

No local verification command creates, modifies, or deploys remote GCP/Firebase resources.

## Still outside the current production claim

- Firestore staging concurrency/load validation.
- IAM service-to-service authentication.
- Pub/Sub and BigQuery.

The Intent Compiler is publicly invokable in the demo deployment because the current Gateway client does not yet attach a Cloud Run identity token. Firestore remains server-only and denies browser SDK access.
