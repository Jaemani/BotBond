# BotBond deployed product audit

Audit date: 2026-08-03

Scope: deployed BShop customer, external-agent, merchant, integration, and live settlement flows at `https://botbond-bshop.vercel.app`.

## Verdict

The product now reads as a merchant-installed agent-access system instead of a presentation dashboard. Role separation is clear, the storefront is credible, and the agent flow exposes where a request stops. The strongest trust improvement is the explicit technology boundary: BShop policy simulation, live Gemini, hosted pay.sh sandbox, HMAC session bridge, and live Solana devnet are not presented as the same thing.

## Steps

1. **Customer storefront — healthy.** `01-shop.png` looks and behaves like an independent commerce surface. Human checkout and the official Agent API entry are separate.
2. **Unknown agent entry — healthy.** `02-agent.png` shows the initial 403, `reached_botbond: false`, `reached_origin: false`, discovery route, and bounded-access CTA.
3. **Merchant operations — healthy with a deliberate empty state.** `03-merchant.png` explains 200, 403, and TTL outcomes without mixing them into the customer experience.
4. **Developer integration — healthy.** `04-integrate.png` explains the WAF boundary, discovery, intent, own-wallet execution, hosted pay.sh sandbox, and HMAC browser boundary.
5. **Live scope denial — healthy after fix.** `05-live-scope-denied-receipt.png` shows Gateway stop, Origin not reached, one denied request, zero penalty, full devnet-token refund, receipt hash, and two confirmed Explorer links.
6. **Live TTL settlement — healthy after fix.** `06-live-abandon-settlement.png` shows objective expiry, 0.25 bounded settlement, 0.75 refund, receipt hash, and confirmed Explorer links.
7. **Live normal refund — healthy.** `07-live-normal-refund.png` shows allowed calls, normal reservation release, zero penalty, full refund, receipt hash, and confirmed Explorer links.

## Fixes found through the audit

- A late duplicate `BOND_OPENED` evidence event regressed UI state from `ACTIVE` to `BONDED`, hiding a real denial. The reducer now prevents lifecycle regression and has a regression test.
- A completed denial session used the generic success headline. It now says `Private request blocked. Bond returned.` and explains that a denied read does not slash the bond.
- Expiry settlement did not emit the final receipt-hash event. Both expiry paths now emit `SESSION_CLOSED` with the exact receipt hash and tests assert it.
- `USDC` was removed from bond settlement evidence. Public runs use a devnet demo mint and the UI says `DEVNET TOKEN`.

## Remaining UX risks

- The public runner has a 10-minute per-network cooldown. The error is explained, but judges sharing one network may need the own-wallet command.
- Live evidence URLs now persist the chosen scenario so their selector and receipt agree when reopened.
- The merchant page is session-local in the browser. A cross-browser operator history view would require a public read model or operator authentication and is outside this demo.

## Accessibility evidence limits

Screenshots confirm readable hierarchy, visible labels, non-color text states, and large primary controls. Automated keyboard traversal, screen-reader announcements for live event changes, contrast ratios, focus visibility, zoom reflow, and reduced-motion behavior were not fully audited from screenshots alone.
