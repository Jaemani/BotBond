# apps/web — BotBond demo shell

Role A deliverable. Renders `BotBondEvent` streams. Decides nothing.

## Run

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

## What it does

Loads rich demo fixtures from `public/fixtures/*.json`, replays them through
`lib/reducer.ts`, and renders four panels: Intent, Contract, Money, Decision
trace. These fixtures preserve demo storytelling while carrying the canonical
`fixtureMarker` and `excludedPermissions` aliases used by Role B. Canonical
minimal/schema fixtures remain in `packages/contracts/fixtures/events-*.json`.
Playback controls sit at the bottom.

`lib/reducer.ts` is the only place event data becomes view state. When the
gateway is live, the same reducer consumes SSE without modification. `usePlayer`
can receive `{ url, token }`; it uses authenticated fetch streaming, ignores
heartbeat comments, deduplicates event IDs, and reconnects with `Last-Event-ID`.
Open `/?sessionId=<id>&token=<token>` for local live mode. Next proxies
`/gateway/*` to `BOTBOND_GATEWAY_URL` (default `http://127.0.0.1:8080`), avoiding
browser CORS restrictions. Optional `gateway` query parameter can override the
proxy path. URL tokens are local-demo transport only; production should inject
them from session state. Development badge appears only after a canonical fake
marker is observed. Fake
provider references never become Explorer links. Missing `REQUEST_DENIED.phase`
is inferred from lifecycle, missing `usageSpentAtomic` is accumulated from
`chargedAtomic`, and live reservation countdown derives from `expiresAt`.

```bash
npm run fixtures:demo
```

Regenerates source fixtures and copies them into `apps/web/public/fixtures`.

## Two things not to break

**Usage and bond are different objects.** Usage is an amber bar that drains and
never comes back. Bond is a cyan block that stays sealed and returns. Different
colour family, different shape, different axis. If they ever look alike, the
product's core distinction is gone.

**Denial does not move the bond.** When `REQUEST_DENIED` arrives the bond visual
holds completely still and a note says so. The stillness is the argument.

## Fixtures

Regenerate after editing `packages/demo-fixtures/generate.py`:

```bash
cd packages/demo-fixtures && python3 generate.py
cp *.json ../../apps/web/public/fixtures/
```

| Fixture | Outcome | Proves |
|---|---|---|
| `01-normal-session` | CLOSED | Bond returns in full when the agent behaves |
| `02-scope-denied` | CLOSED | Blocking is not slashing — penalty stays 0 |
| `03-abandoned-reservation` | VIOLATED | Only an expired reservation settles, and only up to the ceiling |
