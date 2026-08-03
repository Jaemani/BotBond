# BShop product-flow audit

## Verdict

The previous build looked polished but framed BShop as a backdrop for a BotBond presentation. The revised build makes BShop a credible independent merchant and moves automation into the places where it would actually appear: an Agent API and merchant operations.

## Steps

1. **Storefront — healthy.** `02-bshop-storefront.png` shows a normal commerce entry point with working cart and checkout. BotBond is secondary trust infrastructure.
2. **Unknown agent request — healthy.** `03-agent-api-blocked.png` shows the raw request, `403`, machine-readable discovery route, and bounded-access alternative in a developer-facing surface.
3. **Merchant consequences — healthy.** `04-merchant-ops.png` separates successful scoped requests, blocked private-data requests, and abandoned-reservation settlement while keeping live inventory visible.

## Highest-impact changes

- Keep `BShop` as the only primary brand on commerce surfaces.
- Keep Agent API behavior choices out of the human storefront.
- Preserve the distinction between blocking (`403`, penalty `0`) and an objective bonded failure (TTL expiry, bounded penalty).
- Use the same inventory state across storefront, Agent API, and Merchant Ops.

## Evidence limits

The screenshots verify rendered hierarchy and layout. Playwright verifies primary interactions and accessible names, but neither proves complete assistive-technology compatibility. Public fixture playback remains labelled evidence; only a tokenized live-session URL streams a newly created backend session.
