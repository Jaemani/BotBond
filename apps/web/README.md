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

Loads fixtures from `public/fixtures/*.json`, replays them through
`lib/reducer.ts`, and renders four panels: Intent, Contract, Money, Decision
trace. Playback controls sit at the bottom.

`lib/reducer.ts` is the only place event data becomes view state. When the
gateway is live, the same reducer consumes SSE without modification — that is
the contract that keeps this shell from being rewritten at integration time.

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
