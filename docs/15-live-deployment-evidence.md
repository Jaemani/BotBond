# Live Deployment and On-chain Evidence

Last verified: 2026-08-03 (Asia/Seoul)

This page records one continuous live run. It is deployment evidence, not a fixture specification. Private scoped tokens and wallet material are intentionally omitted.

## Public services

| Service | URL | Verification |
|---|---|---|
| Product Web | https://botbond-web-752329931962.us-central1.run.app | HTTP 200 |
| Agent discovery | https://botbond-gateway-752329931962.us-central1.run.app/.well-known/agent-access | HTTP 200 |
| Intent API docs | https://botbond-intent-agent-752329931962.us-central1.run.app/docs | HTTP 200 |
| Solana program | https://explorer.solana.com/address/HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc?cluster=devnet | devnet deployment |

Cloud Run revisions used for the run:

- Gateway: `botbond-gateway-00002-t9k`
- Web: `botbond-web-00002-s8t`

## Continuous live run

- Session ID: `ses_live_2db15bf7-b7a8-40ab-943b-cc329efc7608`
- Intent compiler: `VERTEX_AI`
- Policy hash: `sha256:77f5991c827b7f3aea5da8c1108263238163ae5eed33a1b8f857b1302940b09d`
- Scope denial: `/seller-contacts` returned `403`
- Inventory transition: `1 -> 0 -> 1`
- Usage charged: `0.003 USDC`
- Expiry penalty: `0.25 USDC`
- Agent refund: `0.75 USDC`
- Outcome: `EXPIRED`

Confirmed devnet transactions:

1. [Open 1.00 USDC bond](https://explorer.solana.com/tx/4uRyWTjKN2zeShTcVYgDsqBpY2AVnUsAe9gthDySt78AJzmtdoYK8hJ9v1hK7Vb23wpo9dxWAauERm7JbUQKeymc?cluster=devnet)
2. [Settle 0.25 USDC and refund 0.75 USDC](https://explorer.solana.com/tx/5WfmcvKMQANhPRUPasXYdVxASARhyXkP3SqLLUSbQsbRyhuKpVvSA3WdRksgaqyQdAqQLqnYg1kSmZjKJSaokoaa?cluster=devnet)

Both signatures were independently checked with `solana confirm -u devnet` and returned `Finalized`.

## What this proves

1. Vertex AI compiles a natural-language task into a hashed access policy.
2. The Gateway issues a scoped session and deterministically rejects a forbidden endpoint.
3. A real Solana devnet program locks the bond before the bonded action.
4. Firestore-backed inventory changes when the final unit is reserved and returns after TTL expiry.
5. Settlement cannot exceed the signed ceiling; only `0.25 USDC` is settled and `0.75 USDC` is returned.

## pay.sh verification boundary

On 2026-08-03, the official pay.sh sandbox debugger again completed a `402 -> sandbox payment -> 200 data` request for the MPP quote endpoint. The BotBond local Pay Gate integration has separately returned product JSON through the same x402 sandbox rail.

This does **not** make the deployed Gateway's HMAC session credential a live pay.sh verifier. Current claims must remain:

- pay.sh x402 per-call rail: verified in sandbox
- BotBond session cap: deterministically enforced by Gateway and PaymentAdapter
- Solana bond open/settlement/refund: verified on devnet
- deployed session activation credential: `FAKE_ADAPTER_FIXTURE` HMAC bridge

## Re-run

With the GCP secrets available to the operator:

```bash
GOOGLE_CLOUD_PROJECT=botbond-demo-2026-jaeman \
BOTBOND_PAYMENT_SECRET=<secret> \
BOTBOND_EVIDENCE_SECRET=<secret> \
npm run demo:live
```

Expected output has two JSON lines, `ACTIVE` and `SETTLED`. Each run creates new transaction signatures; do not edit different sessions into one continuous demo.

## Platform note

Firestore Native is active in `us-central1` and is used by the deployed Gateway. The GCP project is not yet visible to Firebase CLI because Firebase project activation returns `PERMISSION_DENIED` even though the operator account has Owner and Firebase Admin roles. This does not affect the current server-side Firestore path, but Firebase Console activation is still required before deploying Firebase rules through the Firebase CLI.
