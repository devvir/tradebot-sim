# Strategy engine

The core of the app. Everything else — the imports, the caches, the charts —
exists so that this part can be fast and honest.

Status: designed, not built. This document fills in the gaps in the sketch and
flags the decisions that need a call before code.

## Why it can be fast

A strategy run is *not* a computation. Every input that drives a decision —
bins, indicators, features — is already on disk, computed once. A run therefore
reduces to: walk the price forward, ask the strategy for decisions, execute
them, and account for the result.

That is the whole speed argument, and it has a corollary that constrains the
design: **the run loop may never compute an indicator.** If a strategy asks for
a series that is not cached, the run fails with "precompute it first" rather
than quietly computing it inline. Otherwise the first slow strategy silently
turns the bench back into a batch job.

## A strategy is a folder

```
strategies/
  ema200-flip/
    strategy.ts      the decision logic — the only unique part
    settings.json    the configurable part
    README.md        what it is, what it assumes, what it showed (optional)
```

Nothing is registered anywhere. The strategy list is the directory listing —
same discovery rule as symbols, tables and indicators.

**Iterating a strategy means copying the folder.** `ema200-flip` →
`ema200-flip-v2`, then edit. The old one stays runnable and its executions stay
comparable, forever. No versioning scheme, no migrations, no "which revision
produced this result" question — the folder *is* the version.

`settings.json` holds everything that could reasonably be tuned without changing
the logic: sizes, thresholds, lookbacks, which indicators to subscribe to. The
split is judgement, not law: if changing a value means changing the code, it
belongs in the code; if it means re-running the same idea differently, it
belongs in settings.

## The run contract

```ts
run(factory, orders, settings)
```

Three arguments, one job each:

- **`factory`** builds the data iterator — what the strategy sees, and at what
  resolution.
- **`orders`** is the only way to affect the world.
- **`settings`** is the parsed `settings.json`.

A strategy sets up its subscriptions, then loops:

```ts
export function run(factory: Factory, orders: Orders, settings: Settings) {
  const iterator = factory.using(BIN_1s).with(['emaslope_200_1m', 'chop_14_5m']);

  for (const step of iterator) {
    const { bin, emaslope_200_1m, chop_14_5m } = step;

    if (crossedUp(emaslope_200_1m)) {
      orders.execute(settings.C, ORDER_MARKET, 'buy');
    }
  }
}
```

Everything repetitive — loading, aligning, filling, accounting, logging — lives
outside. The strategy file contains only what makes this strategy different from
every other one: **what it subscribes to, and when it orders what.**

## The iterator, and the one thing that must not go wrong

`factory.using(BASE).with([...ids])` returns a synchronised iterator: a base
series sets the step, and every subscribed series is carried alongside it.

**The rule: at step `t`, a strategy may only see values that were knowable at
`t`.** This is the single easiest way to produce a backtest that prints money
and means nothing.

The dataset makes the rule simple because everything is **end-labelled**,
BitMEX's own convention: a stamp marks the interval's *close*, so a 1-minute bin
stamped `12:34:00` covers `12:33:00 → 12:34:00` and is fully known at `12:34:00`.
Every derived series keeps that convention. Therefore: **any value stamped
`≤ t` is usable at step `t`** — the iterator forward-fills from the newest stamp
not exceeding the current step, nothing more subtle than that.

The rule is only this simple *because* the convention is uniform. A
start-labelled series mixed in silently leaks up to one bar of the future — this
exact bug shipped in the feature caches and was caught and fixed on 2026-07-23
(see DATA.md, "Time labels"). Any new series must be verified end-labelled
before the engine may subscribe to it.

Consequences to design for, not paper over:

- Every subscribed series carries a **staleness** — a 15m indicator is up to 15
  minutes old at any given step. That is correct, not a defect, and the strategy
  should be able to see the age if it cares.
- **Warmup**: at the start of a range, subscribed series may have no value yet.
  The iterator yields `null` rather than skipping the step, and the run summary
  reports how many steps ran with incomplete inputs.
- **Gaps**: a minute with no trades produces no bin. The base series steps over
  real bins only; it does not synthesise empty ones.

Base resolutions: `BIN_1m` works today. `BIN_1s` is the interesting one for fill
realism and does not exist yet (see [ROADMAP.md](ROADMAP.md)); tick-level base
is further out. Subscribing to a series finer than the base is an error.

## Orders

`orders.execute(size, type, side)` is the whole surface for now. Market orders
only, filled at the base series' step price.

**Fees are the one number that must not be wrong**: BitMEX charges a flat
**0.05% per trade**, maker and taker alike, so a round trip costs **0.10%**.
Maker rebates and the maker/taker differential are gone. This lives in config as
the single source of truth, never inline in a strategy, because almost every
naive strategy is profitable before fees and not after.

Limit orders are deferred deliberately: knowing whether a resting order *would*
have filled requires the tick or 1s data to see whether price actually traded
through the level. Simulating them on 1m bins would be guessing.

Slippage and overshoot are not modelled yet. That is a known optimism in every
result until it is.

## Accounting

Tracked continuously, emitted on every meaningful event:

- **balance** — realised, settled.
- **position** — size and blended entry.
- **uPnL** — unrealised, marked against the current step price.
- **equity** — balance + uPnL. This is the line the chart shows.
- **realised PnL** — cumulative, net of fees.

XBTUSD is an *inverse* contract: it is quoted in USD but margined and settled in
XBT, so PnL is non-linear in price and the existing `core/src/sim/account.ts`
already handles this. The engine reuses it rather than re-deriving it.

Events worth recording: order execution now; funding later — funding is
material over long holds and its absence is another known optimism.

## Execution log

Every run writes, under `$POC_DIR/executions/<strategy>/<runId>/`:

| file | contents |
| --- | --- |
| `run.json` | strategy, full settings snapshot, symbol, range, base resolution, subscribed series, start/end wall-clock, summary stats |
| `events.ndjson.gz` | every meaningful event — fills, funding later — with the account state at that moment |
| `equity.parquet` | the equity/uPnL/PnL progression as a series, for charting |

`runId` is the execution timestamp plus a short hash of the settings, so two
runs of the same strategy at different settings never collide and identical runs
are recognisable.

`equity.parquet` is redundant with `events.ndjson.gz` on purpose. The events file
is the record; the parquet is the thing the chart loads. Deriving the chart from
the log on every view would violate the compute-once rule.

**Settings are snapshotted into `run.json`, not referenced.** Editing
`settings.json` tomorrow must not silently rewrite what yesterday's run claims
to have done.

Executions are deletable from the UI — explicitly, one at a time. That is the
one place in this project where deletion is a normal operation rather than
something to ask about.

## UI integration

The execution chart is the **featured area** at the top of the page: equity,
uPnL and realised PnL over the run's range, on the same x-axis as the candles
below, so a drawdown lines up with the price that caused it.

Two pickers: strategy, then execution within that strategy. The chart after a
run and the chart for a stored run are the same component reading the same
`equity.parquet` — a fresh run is just the newest execution, not a special case.

## Toy strategy — the proof

`ema200-flip`: buy `C` when the 1-minute EMA-200 turns from falling to rising,
sell `C` on the opposite turn. Deliberately naive — its purpose is to exercise
the machinery, not to make money. It will almost certainly lose after fees, and
that is a useful first result rather than a disappointment.

It exercises: the factory and iterator, subscription and alignment, the orders
manager, wallet and uPnL accounting, the execution log end to end, and the UI's
run-and-view path. Once it runs, the platform is real and the work shifts to
strategies rather than plumbing.

The exact signal is not the point and is not worth deliberating: it is an
excuse to exercise the machinery. Taking the cheapest version that needs no new
data — **price crossing `ema_200_1m`**, which is already registered and cached:
buy `C` when `bin.close` crosses above it, sell `C` when it crosses below.

Any other rule would do equally well. If the engine is right, swapping the
signal is a few lines in one file, which is itself the property being tested.

## Open decisions

- **Where the engine lives.** The loop, iterator and accounting are pure and
  belong in `core`. The log writer is `data`. Serving executions is `server`.
  Strategy folders sit at the repo root, outside the packages, because they are
  content rather than code.
- **How strategies are loaded.** They are TypeScript, so a run imports the file
  dynamically. Fine locally; it does mean a strategy can do anything, which is
  acceptable for a single-user bench and would not be otherwise.
- **Multi-symbol runs** are out of scope for now — one symbol per run.
- **Parameter sweeps** are not designed here, but the folder-per-strategy plus
  settings-snapshot-per-run structure supports them naturally: a sweep is N runs
  of one strategy with different settings, and they are already comparable.
