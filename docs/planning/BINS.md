# Bins and Indicators — the canonical contract

The one place the bin ladder and the aggregation rules live, so the list never
has to be repeated and no agent re-derives it wrong.

## The bin ladder

Thirteen sizes, fixed and canonical:

```
1s  30s  1m  5m  15m  30m  1h  4h  12h  1D  3D  1W  1M
```

Every part of the system — bins, MAs, indicators, views — draws from this ladder.
If a size is not on this list it does not exist; if it is on this list it must be
producible. Do not assume a size is unwanted because a message omitted it.

## Cached bases vs derived sizes

A **base** is a bin size stored on disk. Everything else is aggregated from the
nearest base at read time (and *may* be cached, but need not be).

| Base | Origin |
|------|--------|
| `1s` | generated from trade ticks (`make-bins`, one DuckDB `GROUP BY`) |
| `1m` `5m` `1h` `1D` | imported from Mongo (BitMEX aggregations) |

Derived sizes, each with the base it composes from:

| Target | Source base | Factor |
|--------|-------------|--------|
| `30s`  | `1s` | ×30 |
| `15m`  | `5m` | ×3  |
| `30m`  | `5m` | ×6  |
| `4h`   | `1h` | ×4  |
| `12h`  | `1h` | ×12 |
| `3D`   | `1D` | ×3  |
| `1W`   | `1D` | ×7 (ISO week) |
| `1M`   | `1D` | calendar month (variable length — bucket by month, not a fixed multiple) |

The rule for picking a source: the **largest cached base that divides the target**.
That is what keeps a `1W` series reading ~4,000 daily bars instead of millions of
minutes. `1W` and `1M` are calendar buckets, not fixed minute counts — aggregate
them with a calendar bucket (DuckDB `time_bucket(INTERVAL '1 week'|'1 month', …)`),
never `n × 43200 minutes`.

## The generator is blind to caching

There is **one** aggregator, with two parameters: `(sourceSize → targetSize, range)`.
It reads a range of the source (which must be a cached base) and emits the target
bars. It does not know or care whether:

- its source came from disk or was itself generated a moment ago, or
- its output will be cached to disk or streamed straight to a consumer.

A caching script and an on-the-fly server call the *same* generator. Caching is
therefore always optional and always reversible: cache a size to make it fast,
delete the cache to reclaim space, and nothing downstream changes because the
fallback is to generate it. "1s bins exist so nothing downstream ever touches
ticks again" — the same principle one level up: cache a base so nothing touches
the level below it.

## Aggregation math (bin → coarser bin)

Composed bar over its member bars:

```
open   = first member's open        high     = max(member highs)
close  = last member's close        low      = min(member lows)
volume = Σ member volumes           trades   = Σ member trades
turnover, homeNotional, foreignNotional = Σ
vwap   = Σ(member vwap · member volume) / Σ(member volume)
```

**End-labelled, bucket = `floor(ts − 1µs) + iv`.** A bar stamped 11:15 *closes*
the 15m bucket ending 11:15. (This differs from tick→bin, where a trade is a point
in time and uses `floor(ts) + iv`; see `data/src/bins/make.ts`.) End-labelling and
the µs offset are load-bearing and already correct for the tick→1s and the
JS-resample paths — preserve them in any new source→target path.

Note coarser bins do not need `seq` ordering: `open`/`close` of a composed bar are
the first/last *member bar's* open/close, and each member already resolved its own
intra-bar `seq` ties when it was built from ticks.

## Indicators

An indicator is computed over the bars of its timeframe, where those bars come
from the generator above — i.e. from the nearest cached base, not always from 1m.
This is what makes a `1W` EMA cheap and a `1s` EMA possible; the compute function
never sees the difference.

### What gets cached

- **MA / EMA — cache all of them, every period × every ladder size.** They are the
  reference every other reading is taken against, they are wanted at whatever
  resolution the chart is on, and they are tiny (a list of numbers, stored sparse —
  one row per change, §below). Periods: 9, 20, 50, 100, 200.
- **Other indicators — case by case.** Windowed/recursive families (RSI, ATR,
  Stochastic, Choppiness, Efficiency Ratio, Bollinger, Donchian, MACD, STC,
  realized vol, the volume/trade EMAs) are genuinely different series per timeframe
  and are cache-worthy where used. Pure point transforms of already-cached series
  (EMA slope = diff of an EMA, EMA spread = diff of two EMAs, returns, per-bin VWAP
  deviation) need no cache of their own — derive on read.

### Caching is a hint, not a contract

Every indicator works whether or not it is cached: if the cache file is absent,
the series is generated on the fly. So the decision to cache is a pure performance
choice, revisitable at any time with no code change — cache it if it proves worth
it, delete it if not.

An indicator spec therefore carries an explicit **`cached`** flag. `cached: false`
means "intentionally not cached" — the UI must treat its absence from disk as
normal and must **not** warn that it is missing. Only a `cached: true` indicator
that is absent is worth a warning.

### Sparse storage (no forward-fill duplication)

A `5m` value does not change within its five minutes; storing it once per minute
is five identical rows for one fact. Indicator series are stored **one row per
change** (step function). The reader carries the last change at or before the
window start into the window, so a slow series still renders from its first
visible point. This makes the full MA/EMA ladder cheap even at the long end (a
`1D` RSI over 11 years is a few thousand change-points).
