# Live Deployment and On-chain Evidence

Last verified: 2026-08-03 22:35 KST

This page records fresh public runs against the deployed services. Private scoped tokens and wallet material are intentionally omitted.

## Public services

| Service | URL | Verified state |
|---|---|---|
| BShop product | https://botbond-bshop.vercel.app | Vercel production; `/shop`, `/agent`, `/merchant`, `/integrate` captured |
| Agent discovery | https://botbond-gateway-752329931962.us-central1.run.app/.well-known/agent-access | HTTP 200; publishes public runner, program, and pay gate |
| Hosted pay.sh gate | https://botbond-pay-gate-752329931962.us-central1.run.app | protected endpoint returns x402 `402 Payment Required` |
| Intent API | https://botbond-intent-agent-752329931962.us-central1.run.app | Vertex AI Gemini compiler |
| Solana program | https://explorer.solana.com/address/EG9rKPV69v3WNX7aVchAPonMtKPp6yML7jZwDjMKaRKR?cluster=devnet | reproducibly built and deployed devnet program |

Current revisions:

- Gateway: `botbond-gateway-00008-gxs`
- Intent: `botbond-intent-agent-00004-jwj`
- pay.sh Gate: `botbond-pay-gate-00003-zsl`
- Cloud Run Web: `botbond-web-00005-lsb`
- Vercel: `dpl_EZywTVHMiMYkuXGvsuPgsJKWWRZb`

## Evidence validity after reproducible program deployment

The earlier `Hoam…` program and its transactions are **retired as submission evidence**. Its deployed binary did not match the repository's checked-in build artifact.

The current submission program is `EG9rKPV69v3WNX7aVchAPonMtKPp6yML7jZwDjMKaRKR`:

- the checked-in deploy keypair derives to `EG9…`;
- `anchor build` now completes using the checked-in source;
- the SHA-256 of `target/deploy/botbond.so` exactly matches the binary downloaded from devnet; and
- the Gateway now discovers and verifies only this ID.

[Program deployment transaction](https://explorer.solana.com/tx/2Cd4dyqLKnVgyR8VxoiSE3YMzYc5QAYV2Q2eykLpRqYC9txw4RcgGF8rkPmSSWQd59oP8i2PV6vDx8yMCKQF2NMh?cluster=devnet)

## Same Gateway: direct rejection versus official scoped request

This comparison was executed against the deployed Gateway on 2026-08-03 21:16 KST. It is not a fixture or a browser-only state.

| Request | Result | What it proves |
|---|---|---|
| `GET /products` without a session | `403 UNKNOWN_AUTOMATED_CLIENT` | the unscoped route is rejected by the live Gateway and advertises `/.well-known/agent-access` |
| `GET /v1/access/ses_public_fa4f3ad8-942a-4053-86ad-d63ad3bb59b2/products` with that session's scoped token | `200` with two filtered product records | the same deployed Gateway accepts the official lane only after a fresh policy and bond |

The accepted session compiled policy hash `sha256:12e56608c94e0e2076ce79241529008ba1a6df1b8286775de53ce990bc3c85d6`, metered four allowed requests, then closed with a full bond return. Its receipt hash is `sha256:b68aea8ebeab3ec3e80068e9689702c482d3ff6e170c049c30b4983e114edcc7`.

- [Fresh bond open](https://explorer.solana.com/tx/4kkFpZNN3DNzDEYqTuA9eXd7fsYv6kUvZRRV7posqddUUviFxWFvTJdKPRTDskdcFKNJnwFxZQBTzJR5Zoj3m961?cluster=devnet) — `confirmed`
- [Fresh full refund](https://explorer.solana.com/tx/c57kFGFjgxpW1zkWzyPCxVWzjmJYNhAhaUEH2o6rGtTHUaHbQsRyVNen8ZgAhLPpPyAdzDUxEJexkieLcDWJ61S?cluster=devnet) — `confirmed`

The receipt's usage-payment record is explicitly a `FAKE_ADAPTER_FIXTURE`; this public browser run uses the HMAC bridge. It does **not** prove MPP session payment. The separately verified hosted pay.sh sandbox evidence remains below.

## Product connection check (current Vercel deployment)

[`/integrate`](https://botbond-bshop.vercel.app/integrate) sends three real browser-originated requests through Vercel's server-side proxies:

| Request | Current result | Meaning |
|---|---:|---|
| `GET /.well-known/agent-access` | `200` | deployed Gateway discovery publishes `EG9…` |
| `GET /products` | `403` | direct unknown automation is rejected |
| pay-gate `GET /v1/access/browser-check/products` | `402` | hosted pay.sh sandbox issued an x402 challenge |

The check is deliberately non-paying: it makes the payment boundary visible before the user chooses the own-wallet CLI path. Captured current state: [`09-live-integration-check.png`](audit/final-product/09-live-integration-check.png).

The root route now starts with BotBond's mechanism and treats BShop as the merchant integration, rather than making the storefront the product entry: [`11-botbond-overview.png`](audit/final-product/11-botbond-overview.png).

## Fresh current-program scope denial

Executed through the public sponsored runner on 2026-08-03 21:48 KST, after deployment of `EG9…`:

- Session: `ses_public_701d5ad7-0f38-439e-9af7-91baf53b2c41`
- Result: private request blocked before origin; `penaltyAtomic: 0`; `bondRefundedAtomic: 1000000`
- Receipt: `sha256:ba8b8d13bc9e7b09700e6fa7d6e9ae70597206d5966d031eb3b834fa352c4618`
- [Bond open](https://explorer.solana.com/tx/2Sw79teX6ZfXhknPBpNHxVWo18y14jj29JFYKNeWbZx6vTZhYMrZTpATqJp3mRagRcHjkET9vzehPo1narHF1ZJA?cluster=devnet) — `confirmed`
- [Bond returned](https://explorer.solana.com/tx/nF4dwH3htZfjS3nega6ZLVEaYNbsd4JambZiYKWKMsWE4Duo9rWWDcknuhfTVJanzkAYzK7bu2V3Fc63ji3Mndm?cluster=devnet) — `confirmed`

Captured current state: [`10-live-scope-denied-eg9.png`](audit/final-product/10-live-scope-denied-eg9.png). This is live Solana devnet with the browser HMAC payment bridge—not proof of a pay.sh session credential.

## Public-run retry policy

The sponsored runner has no per-IP cooldown. It retains a 500-run daily budget and one active execution lease so a reviewer is never asked to wait after their own completed run, while simultaneous requests cannot race the shared merchant fixture. The change was verified by completing another fresh normal run after the previous scope-denial run:

- Session: `ses_public_a9c575a9-b45b-40a2-98a4-b206306cda80`
- [Bond open](https://explorer.solana.com/tx/2qGvwN2Z3udrRAwBKCPKEPU8iCkWo24vemtuqjrndM8oZLwQRsdip9YQbR1SauiP56JpBGoXayQb3mrxhR2JyfAt?cluster=devnet) — `confirmed`
- [Bond returned](https://explorer.solana.com/tx/4tisLcC942W3EJHEo7FVjsfjHWdZq9wKwSy4CjJ2bDcqJvWQ56qDn1kaK4i7vbMwrBRpN1qqR62HcsVcmMHh6P8K?cluster=devnet) — `confirmed`

## Retired historical evidence (do not use in presentation)

The sections below retain older run metadata for incident tracing only. They refer to the retired `Hoam…` deployment and must not be presented as current evidence. New scope-denial and TTL-settlement evidence will be recorded against `EG9…` before final submission.

### Retired: normal release and full refund

- Session: `ses_public_f512b482-ae32-4407-9f46-69daea4c23eb`
- Outcome: `CLOSED`
- Penalty: `0`
- Bond returned: `1,000,000` atomic units of the devnet demo mint
- Receipt: `sha256:e3ff28c3d2c0565f2b72c868b0ddb4fb32916be7dd3d8ba8f3898d58fde926c8`
- [Bond open](https://explorer.solana.com/tx/2NYQrnvjrHUNjDqRpjr6MbcXBhxC8NrSmUb8t2d1WxLFM5EhvJtQ3rmYUPtYeqTVtBPRrvTJGkt8LYgyF4gUxcxw?cluster=devnet)
- [Full refund](https://explorer.solana.com/tx/nCj7Wb4djSoJW3Bjx6esffMeWPxCco7QJc8iix1n3ifC9CpcLDfLuHB9BGoSUmFgb4CPW8sfECocTzjUTpNnYqP?cluster=devnet)

### Retired: scope denial without slashing

- Session: `ses_public_020afbaf-4ef8-4bfd-bf5a-e2cd935d2e66`
- `/seller-contacts`: `403 OPERATION_NOT_ALLOWED`
- Origin reached for denied request: `false`
- Protected data exposed: `false`
- Penalty: `0`
- Bond returned: `1,000,000` atomic units
- Receipt: `sha256:ebc693a95add9a953ac9a5559f3ec987aba165a376162f45c93fbe306d301ee3`
- [Bond open](https://explorer.solana.com/tx/4bXRPeC72iayarAycEeLhSpUH5YHKZ7xJzn2HNGNoovVRxaJQs5mJkrnfXVgY52BfuKGcMWrsAnwMVLPMmvkHf2j?cluster=devnet)
- [Full refund](https://explorer.solana.com/tx/2EQzvGKteuxwUp4ien3DAm7Gd2T8uSjpymdESVGfyzrkgKap5nAhi9CmNDEkSyzQqNNFfsPq7mqXpHU5PyhGtLx?cluster=devnet)

### Retired: objective TTL expiry and bounded settlement

- Session: `ses_public_3bdc04b5-56b6-4053-aa86-6b610496e27b`
- Inventory: `1 → 0 → 1`
- Outcome: `EXPIRED`
- Penalty: `250,000` atomic units
- Bond returned: `750,000` atomic units
- Receipt: `sha256:5eb3e2c8a6a4598e11e51d4059a35674bad5ba5941607edc15471609400ca047`
- [Bond open](https://explorer.solana.com/tx/3AQdU3R2KzwmkpEEA8KjvczYjaLH7ueYJYaB29wR9ekyMqRwQyFXH6Vtvrg49M36XzktBL2PQnfmpzG75is4y1aV?cluster=devnet)
- [Bounded settlement and remainder refund](https://explorer.solana.com/tx/23KFr73XZdpmf19CgJnuxvqHeVprLJrRgENfMky3Ysq76hi3WxTcTcCzWQgcxoociLh5tLfgJEEcWeybXLvcDJy8?cluster=devnet)

These retired signatures are kept only for incident tracing. They must not be used in a deck, README, video, or submitted evidence.

## Historical external-agent run through hosted pay.sh x402

This run records the separately verified pay.sh sandbox rail. Its Solana signatures predate the reproducible-program correction, so use it only as payment-rail history; re-run the current external-agent command before final submission to capture `EG9…` program evidence.

- Session: `ses_external_b12e5f17-e352-436a-bd13-dc04d4da15a4`
- pay.sh result: product JSON and inventory JSON returned after sandbox payment
- Session credential mode: `HMAC_DEMO_BRIDGE`
- [Bond open](https://explorer.solana.com/tx/3dhx8bchPQeYamUNvg16jqdySev6Kysynj7taeBV2zK7XaSMMm9LtbjwQvpXaD1VbN3rBwe4GwmBTvg5L3xWVWQn?cluster=devnet)
- [Full refund](https://explorer.solana.com/tx/4ZyMVmsjVTpmHHGZSKFwgMJRLDsdwawmCy8R2VZLm6t8r9xWCyWJxvvtNU5rE7syRTTfYqptQPV33wyPBSkGZSZy?cluster=devnet)

## Exact implementation boundary

| Component | State | Claim allowed |
|---|---|---|
| Vertex AI Gemini | live | merchant-catalog intent compilation |
| Cloud Run + Firestore | live | API, state, ordered evidence |
| Solana program | live devnet | bond open, refund, bounded settlement |
| pay.sh x402 | hosted sandbox | per-call `402 → sandbox payment → scoped API 200` |
| BotBond session activation | demo bridge | HMAC credential; not pay.sh session verification |
| MPP capped repeated session | not E2E verified | do not claim implemented |
| Cloudflare zone/WAF | not integrated | BShop Gateway only reproduces a comparable 403 policy |

The SPL asset used by public runs is a **devnet demo mint, not USDC**. The browser labels it `DEVNET TOKEN`.

## Re-run

Public sponsored runner:

```bash
npm run verify:public-run -- normal
npm run verify:public-run -- scope-denied
npm run verify:public-run -- abandon
```

Own wallet plus hosted pay.sh sandbox:

```bash
npm run example:external-agent -- \
  --gateway https://botbond-gateway-752329931962.us-central1.run.app \
  --wallet ~/.config/solana/id.json
```

The public runner has a 10-minute hashed-IP cooldown, daily budget, and one active creation lease. It never stores raw IP addresses.
