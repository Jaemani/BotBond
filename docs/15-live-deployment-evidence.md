# Live Deployment and On-chain Evidence

Last verified: 2026-08-03 20:37 KST

This page records fresh public runs against the deployed services. Private scoped tokens and wallet material are intentionally omitted.

## Public services

| Service | URL | Verified state |
|---|---|---|
| BShop product | https://botbond-bshop.vercel.app | Vercel production; `/shop`, `/agent`, `/merchant`, `/integrate` captured |
| Agent discovery | https://botbond-gateway-752329931962.us-central1.run.app/.well-known/agent-access | HTTP 200; publishes public runner, program, and pay gate |
| Hosted pay.sh gate | https://botbond-pay-gate-752329931962.us-central1.run.app | protected endpoint returns x402 `402 Payment Required` |
| Intent API | https://botbond-intent-agent-752329931962.us-central1.run.app | Vertex AI Gemini compiler |
| Solana program | https://explorer.solana.com/address/HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc?cluster=devnet | deployed program |

Current revisions:

- Gateway: `botbond-gateway-00006-z9w`
- Intent: `botbond-intent-agent-00003-bv2`
- pay.sh Gate: `botbond-pay-gate-00002-2pq`
- Cloud Run Web: `botbond-web-00004-fzr`
- Vercel: `dpl_5dR73XCyZmoPnkutHHDy2oUukbDc`

## Public run: normal release and full refund

- Session: `ses_public_f512b482-ae32-4407-9f46-69daea4c23eb`
- Outcome: `CLOSED`
- Penalty: `0`
- Bond returned: `1,000,000` atomic units of the devnet demo mint
- Receipt: `sha256:e3ff28c3d2c0565f2b72c868b0ddb4fb32916be7dd3d8ba8f3898d58fde926c8`
- [Bond open](https://explorer.solana.com/tx/2NYQrnvjrHUNjDqRpjr6MbcXBhxC8NrSmUb8t2d1WxLFM5EhvJtQ3rmYUPtYeqTVtBPRrvTJGkt8LYgyF4gUxcxw?cluster=devnet)
- [Full refund](https://explorer.solana.com/tx/nCj7Wb4djSoJW3Bjx6esffMeWPxCco7QJc8iix1n3ifC9CpcLDfLuHB9BGoSUmFgb4CPW8sfECocTzjUTpNnYqP?cluster=devnet)

## Public run: scope denial without slashing

- Session: `ses_public_020afbaf-4ef8-4bfd-bf5a-e2cd935d2e66`
- `/seller-contacts`: `403 OPERATION_NOT_ALLOWED`
- Origin reached for denied request: `false`
- Protected data exposed: `false`
- Penalty: `0`
- Bond returned: `1,000,000` atomic units
- Receipt: `sha256:ebc693a95add9a953ac9a5559f3ec987aba165a376162f45c93fbe306d301ee3`
- [Bond open](https://explorer.solana.com/tx/4bXRPeC72iayarAycEeLhSpUH5YHKZ7xJzn2HNGNoovVRxaJQs5mJkrnfXVgY52BfuKGcMWrsAnwMVLPMmvkHf2j?cluster=devnet)
- [Full refund](https://explorer.solana.com/tx/2EQzvGKteuxwUp4ien3DAm7Gd2T8uSjpymdESVGfyzrkgKap5nAhi9CmNDEkSyzQqNNFfsPq7mqXpHU5PyhGtLx?cluster=devnet)

## Public run: objective TTL expiry and bounded settlement

- Session: `ses_public_3bdc04b5-56b6-4053-aa86-6b610496e27b`
- Inventory: `1 → 0 → 1`
- Outcome: `EXPIRED`
- Penalty: `250,000` atomic units
- Bond returned: `750,000` atomic units
- Receipt: `sha256:5eb3e2c8a6a4598e11e51d4059a35674bad5ba5941607edc15471609400ca047`
- [Bond open](https://explorer.solana.com/tx/3AQdU3R2KzwmkpEEA8KjvczYjaLH7ueYJYaB29wR9ekyMqRwQyFXH6Vtvrg49M36XzktBL2PQnfmpzG75is4y1aV?cluster=devnet)
- [Bounded settlement and remainder refund](https://explorer.solana.com/tx/23KFr73XZdpmf19CgJnuxvqHeVprLJrRgENfMky3Ysq76hi3WxTcTcCzWQgcxoociLh5tLfgJEEcWeybXLvcDJy8?cluster=devnet)

All six signatures were queried through Solana devnet RPC after execution and returned `confirmed` or `finalized` with no error.

## External-agent run through hosted pay.sh x402

The repository example used its own devnet wallet and completed two hosted pay.sh x402 sandbox calls before settling its bond.

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
