# Minimal Cloud Run Preparation

Local E2E and contract tests are deployment gate. These commands are templates, not evidence of deployment.

## Services

- `botbond-intent-agent`: Python 3.12 FastAPI, `PORT`, optional Vertex AI provider.
- `botbond-gateway`: Node 22 Fastify, `PORT`, `INTENT_COMPILER_URL`, adapter mode.

## Required production configuration

Gateway:

```text
ADAPTER_MODE=real
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

Do not deploy Gateway with `ADAPTER_MODE=fake` as live evidence. Fake mode exists for local/CI only and marks responses/events.

## Minimum platform dependencies

1. Artifact Registry for two images.
2. Cloud Run for Gateway and Intent Compiler.
3. Vertex AI API for Intent Compiler.
4. Firestore repository and emulator contract are implemented; create database and deploy `firestore.indexes.json` before multi-instance staging. See `infra/firestore.md`.
5. Secret Manager for Role C credentials; never plain environment values in deploy scripts.
6. Cloud Logging/Trace through structured stdout and propagated `x-trace-id`.

## Deferred until integration

- Actual deploy commands and revisions.
- Firestore staging concurrency/load validation.
- Real payment/bond adapter images and secrets.
- IAM service-to-service authentication.
- Pub/Sub and BigQuery.
