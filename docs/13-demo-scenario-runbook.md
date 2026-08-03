# Outcome-led Demo Scenario Runbook

The demo should answer one merchant question per scenario. The decision trace is
evidence, not the headline.

## Shared local facts

- The executable `DemoCommerceApi` catalog is `lap-1` (OrbitBook 14, stock 2)
  and `lap-2` (NovaBook Air, stock 1).
- Usage costs `0.001 USDC` per allowed call. A bond is `1.00 USDC`; expiry can
  settle only the signed `0.25 USDC`, below the `0.30 USDC` ceiling.
- Each fixture is explicitly development evidence. A fake reference must never
  be presented as an Explorer transaction.

## 1. Accountless, bounded buying research

**Question:** Can a new agent do a small buying task without a pre-issued API
key or an open-ended credential?

**Replay:** Discover the official endpoint, compile the task, compare `lap-1`
and `lap-2`, hold `lap-1`, release it, then close.

**Show the result:** only three data calls cost `0.003 USDC`; `lap-1` inventory
returns from `1` to `2`; the full `1.00 USDC` bond returns.

## 2. Scope guard without false punishment

**Question:** Does one inappropriate request turn a normal agent into a
punished agent?

**Replay:** After an allowed product lookup, request `/seller-contacts` and a
review body. Then complete the remaining allowed inventory lookup and close.

**Show the result:** both denied requests stop before upstream and expose zero
protected records. They cost nothing and produce `penaltyAtomic: "0"`; the
bond remains whole.

## 3. Last-unit recovery with bounded responsibility

**Question:** What protects a merchant when an agent holds the final unit and
disappears?

**Replay:** Hold the only `lap-2`, let the 60-second TTL expire, and inspect
the receipt.

**Show the result:** inventory changes `1 → 0 → 1`; expiry is a deterministic
fact, not an LLM judgment; `0.25 USDC` settles within the signed ceiling and
`0.75 USDC` returns.

## Presenter order

1. Start scenario 1 at 2×. Pause on the compiled contract and on the final
   receipt.
2. Start scenario 2 at 2×. Pause exactly on the first red trace row and point
   to `bond ±0` before continuing.
3. Start scenario 3 at 4×. Pause on the held last unit, then on expiry and the
   split bond block.

The 20-laptop request remains an Intent Compiler cap-clamping evaluation. It
is deliberately not the visual demo, because the executable commerce catalog
contains two deterministic SKUs.
