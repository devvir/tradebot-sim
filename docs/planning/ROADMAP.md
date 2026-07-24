# Roadmap and ledger

What is being built, what is next, and what is deliberately parked. Entries here
are detailed and technical on purpose — they double as handover between working
sessions. An item leaves this file when it is done and its behaviour is described
in the layer docs instead.

Status as of **2026-07-23**. Snapshot: the dataset is complete and verified
(2015 → 2026-06-30, all symbols, plain `TIMESTAMP` UTC); all 55 registered
indicators and all 17 features are cached at full range for XBTUSD,
**end-labelled** per the exchange convention (see ../DATA.md "Time labels" —
this was a real defect found and fixed 2026-07-22/23). The API reproduces
native `tradeBin5m` aggregation exactly. UI: viewport buffering, indicator
menu, log axis, grid/axes all landed; 59 tests green.

**Today's queue, in order:** 2f (indicator rework — gates everything), MA/EMA
registry additions (2g, minus the 1s tier), `precompute-indicators --all`,
1s bins, then 2a / 2e / 2c / views as bandwidth allows.

Latest session handoff: [HANDOFF-2026-07-23.md](HANDOFF-2026-07-23.md) — in-flight MA/EMA expansion, dedup-on-write, and the open 1s-averages decision.

Layer documentation: [../DATA.md](../DATA.md), [../API.md](../API.md),
[../UI.md](../UI.md). Design in progress:
[STRATEGY-ENGINE.md](STRATEGY-ENGINE.md), [UI.md](UI.md).

## In flight

- **tznorm** (`poc-tznorm` unit): converting quote parquet `TIMESTAMPTZ` →
  plain `TIMESTAMP`; ~1395/1455 files done, XBTUSD finished first. Resumable,
  idempotent (skips converted files). When done, the whole dataset is uniformly
  plain `TIMESTAMP` UTC.
- Everything else in the import pipeline is **done and verified**: trade
  re-imported as `TIMESTAMP` (12/12 years), quote/bins complete, row counts
  exact vs raw (incl. the pool filter: Secondary's 284,007 rows excluded by
  instruction, arithmetic verified).
- The raw gzips (~307 GB) stay until the user deletes them; `.megaignore` is in
  place at the dataset root.

## Next

### 0. Strategy engine

The core of the app: run a strategy over cached data, account for the result,
log it, and chart it. Designed in [STRATEGY-ENGINE.md](STRATEGY-ENGINE.md).

The `ema200-flip` toy strategy is the acceptance test — when it runs end to end,
the platform is real and work shifts from plumbing to strategies. Its signal is
deliberately arbitrary (price crossing the already-cached `ema_200_1m`); the
machinery is the deliverable, not the rule.

### 1. ~~API layer~~ — DONE (discovery + series)

`/api/symbols|tables|bins|indicators|candles|indicator/:id` exist; indicators
endpoint is a directory listing (never scans data). Aggregation is end-labelled
and verified to reproduce native `tradeBin5m` exactly, range semantics
`(from, to]`. Still to come with the strategy engine: execution endpoints.

### 2. ~~UI base~~ — DONE

Four areas, shared `IndicatorPane`/`IndicatorSelector`, persisted state, shared
range, Tailwind v4, Radix popovers, log axis, grid/axes, native-wheel pan/zoom
(chart is king; empty areas cost only their control bar).

### 2a. Month-granularity chunking

**Decided: chunk everything monthly, uniformly — data tables, features and
indicator caches.** Write `<year>-<month>.parquet`; readers already glob the
directory, so nothing downstream changes.

**The reason is correctness, not performance.** The importer builds a chunk from
whatever files are sitting in `raw/<table>/<year>/`:

```ts
readdirSync(join(tableDir, year)).filter((f) => f.endsWith('.csv.gz'))
```

`raw/` is staging that repopulates per top-up. So with year chunks, staging one
month's dailies and re-running the year with `--force` produces a year file
containing **only that month** — the rest silently destroyed, with a successful
manifest entry to match. Safe year chunks would require keeping the entire
current year staged (~40 GB by December) purely to rebuild what already exists.
With month chunks the failure is unrepresentable: a new month writes a new file
and touches nothing else.

The alternative mitigation — a guard refusing to write a chunk when the raw day
count looks wrong — is a smaller change, but it prevents an accident rather than
removing its possibility.

**Everything else was measured and rejected as a justification.** Do not rebuild
the argument from these:

| considered | verdict |
| --- | --- |
| read speed on sub-month ranges | **no difference** — 1-day query: 1.09 s from a 3.51 GB year file vs 0.89 s from a 0.35 GB month file. Row-group statistics already prune the year file. |
| recompute time | irrelevant — an overnight job once a month costs nothing |
| upload volume | irrelevant — flat-rate connection |
| file count (~8.8 k → ~105 k), footer overhead, compression | noise against 239 GB |
| resolution-dependent chunk sizes | rejected — a `1M` chunk holding one row looks odd but costs nothing, and one convention beats an exception to remember |

Features are stateless per-minute aggregates, so month chunks are exactly as
correct as year chunks. Indicators are stateful and still need their warmup
overlap when extending — chunking changes where output lands, not how it is
computed.

Do this before the first monthly top-up.

### 2b. ~~Viewport data loading~~ — DONE

Windowed cache (`web/src/window.ts`, 13 tests): zoom-in never fetches, margin
over-fetch, edge prefetch, stale-while-loading, debounce + AbortController.

### 2c. Volume bars — UNBLOCKED

Self-scaled volume pane inside the chart (~20% height, configurable), losing
side overlaid from the bottom. `tf_buyvol_1m`/`tf_sellvol_1m` are now full-range
and end-labelled — serve them alongside candles (sum upward for coarser bins).
Data note: minutes with only one side carry **NULL** for the absent side
(`sum FILTER` over an empty set) — render NULL as 0; a `coalesce(...,0)` in the
feature registry can ride the next recompute.

### 2d. ~~Indicator menu at scale~~ — DONE

Family columns, favourite stars, Favorites/All tabs (Favorites default),
content-sized popover.

Related: the volume area is a pane pinned inside the chart, so volume-family
indicators overlay it with `pane: 'volume'` — no new routing concept needed.

Also queued for design: **timeframe-relative indicators** — pinned-timeframe
overlays (works today) versus auto-matching ones that follow the view's bin
size (does not exist, and a coarse indicator is not derivable from its fine
version). Written up in [UI.md](UI.md) under "Timeframe-relative indicators".

### 2e. Reorganise the data folder — first-letter split DONE (2026-07-23)

**Done:** all 854 symbol directories moved under `symbols/<L>/<SYMBOL>/`
(digits pooled as `0-9`), behind the single `symbolDir(config, symbol)` helper in
`@poc/core` that every per-symbol path now routes through. Root is clean
(`symbols/`, `raw/`, `manifest/`). `listSymbols` scans two levels; candles,
indicator series and discovery all verified against the new layout. The internal
per-symbol reorg (grouping `runs/`, `legacy/` for the superseded csv/ndjson) is a
separate optional cleanup — deferred, not blocking.

Original target (internal grouping still aspirational):

```
scalper-poc/
  raw/<table>/<year>/YYYYMMDD.csv.gz
  symbols/<L>/<SYMBOL>/           L = first char, digits pooled as `0-9`
      parquet/<table>/<year>.parquet     primary tick + bin data
      indicators/<id>.parquet            cached series
      features/<source>/<year>.parquet   resumable parts
      runs/                              sim, batch, bands, ranges, html
      legacy/                            superseded csv/ndjson
  manifest/<table>-<year>.json
  logs/
  tmp/                                   duckdb spill, spools
```

The letter level splits 856 directories into 27 buckets. It stays lumpy —
BitMEX is mostly `XBT*`, so X alone holds 235 — but the worst case improves
3.6× and the rule is predictable, which matters more than balance when looking
for something by hand.

**Do it behind one helper.** Every path today is an ad-hoc
`join(config.pocDir, symbol, ...)` spread across the reader, the partitioner,
both precomputes and the extractors. Introduce `symbolDir(config, symbol)` and
route everything through it, so this is the last time a layout change means
touching many files.

**What syncs to cold storage, and what does not.** The dataset is to be synced
for versioning and backup, so the layout must separate what is worth keeping
from what is reproducible or scratch. Excluded: `raw/` (already in cold storage —
re-uploading duplicates it), `legacy/` (superseded, fully represented in
parquet), `tmp/` and `logs/`. That leaves the parquet dataset, the caches and
the manifest as the versioned set.

`parquet/<trade|quote>/` is **primary data, not intermediate** — features
aggregate from it, and 1s bins, tick-level fill simulation and the barrier
labeller will all need it. What belongs in `legacy/` is the ~299 GB of flat
`trade.YYYY.csv` / `quote.YYYY.csv` from the retired extract-then-convert path,
which nothing in the codebase reads.

### 2f. Indicator rework — clock alignment DONE, storage rework DROPPED

**Done (2026-07-23):** `resampleBins`/`resample` bucketed by array position
(`i += tf`), not by the clock. Buckets were anchored to wherever each symbol's
data began, and gaps stretched them across arbitrary wall time — XBTUSD is
missing 10.8% of its minutes, so a "5m" bar routinely spanned six or more.
Now bucketed by `floor(t - 1ms) + tf`, end-labelled like everything else, with
the lookahead rule enforced (a bin sees a bucket only once it has closed).
All 849 symbols recomputed. Verified against BitMEX's own 5m bars: 1m→5m closes
match 2016/2016 exactly, and a 20-period EMA over them agrees to 0.000000% once
past its seed.

**Dropped: native-resolution storage.** The original case was 33 GB → 4 GB. That
estimate counted *values* and ignored Parquet's run-length/dictionary encoding,
which already compresses the repetition. Measured: `ema_20_5m` is 20.9 MB
1m-aligned vs 10.1 MB native — **2x, not 8.3x** — against a 40 GB total and
1.4 TB free. Reads are not faster either (0.12 s for a month from the 1m-aligned
file, quicker than the 1m file itself). Not worth the rework or the migration.

**Still open, but no longer urgent: chunked computation.** `precomputeIndicators`
holds a symbol's whole bin history as JS objects. Independent of storage format.
The all-symbol run peaked at 5.6 GB against a 12 GB ceiling, so it is headroom
management rather than a blocker — revisit if a symbol grows or the registry
gains much heavier indicators.

### 2g. MA/EMA expansion

Cache MA and EMA at every bin size (1s, 1m, 5m, 15m, 30m, 1h, 4h, 12h, 1D, 3D,
1W, 1M) for periods **9 (new), 20, 50, 100, 200** — 110 series/symbol (~11× the
XBTUSD cost when run `--all`; indicator cost scales with bin count, and XBTUSD
is only 9% of the 55.7 M cached minutes). The 1s tier is now unblocked (1s bins exist for all symbols). Add the specs **before** the `--all` pass so it runs once.
The user also has experimental indicators queued — take the list before that
pass.

### 2g-bis. Symmetric log axis

A plain log axis cannot render signed series, and several cached ones straddle
zero while spanning orders of magnitude: `tf_delta_1m`, `emaslope_*`, `vwapdev`,
`qf_imbalance_1m`. Symlog — compress `|v|`, mirror about zero, with a linear
region near zero since `log(0)` is undefined — makes those panes readable.
Useful well beyond the detrended view.

### 2h. Views

A third element type: derived renderings computed on the fly, not cached, with
their own per-view options. First one is detrended candles — OHLC shifted so a
chosen average is flat, log (ratio) by default. Design in [VIEWS.md](VIEWS.md).

### 3. ~~Chunk `features/precompute.ts`~~ — DONE

Chunked and banked per year on 2026-07-22; `scripts/overnight.sh` is no longer
disabled. Kept here for the measurements only.

**Was the known landmine.** It still aggregates the full range as one atomic query —
the exact shape that failed three times, each time SIGTERM'd at the memory cap
after hours and returning *zero* output. `scripts/overnight.sh` is disabled
because of it and carries a warning at the top.

Fix: loop years, one aggregation per year, write
`features/parts/<id>/<year>.parquet`, then combine from whatever parts exist.
Same chunk-and-bank pattern the importers already use.

Measured, do not re-derive: a trade `GROUP BY` minute over **one year** costs
~235 MB peak RSS and 10–17 s. Over **nine years** it exceeded 8 GiB and never
completed. Two plausible culprits — `approx_quantile` and the ordered aggregate
`last(price ORDER BY timestamp)` — were each confidently blamed and each
disproved head-to-head. Chunking by year bounds the cost regardless, which is
why the true full-range ceiling does not matter.

### 4. ~~Compute the uncached indicators~~ — DONE

All 55 registry specs + 17 features cached at full range for XBTUSD
(2015-09-25 → 2026-06-30/07-19). The run peaked at **6.46 GB heap** — right at
the raised limit — which is why `--all` waits for 2f.

## Research

Empirical findings and open questions live in [RESEARCH.md](RESEARCH.md).
First entry: range-extension statistics (a bar breaking one side of its
predecessor holds the other ~80% of the time when the break is early).

## Parked, by design

### 1-second trade bins

Wanted for aggregation below 30 s and, more importantly, **fill-simulation
accuracy** — not primarily for display. Not obtainable from the cached 1m bins
(bins compose upward only); must be generated from the trade tick Parquet, which
Mongo cannot supply. Blocks the `1s` button in the chart, which stays disabled
until they exist.

### Tick-based candles

Bins closed by a fixed **number of trades** rather than elapsed time. A paradigm
change, not another candle type: the x-axis stops being uniform time, which
touches the chart, the indicator cache alignment, and every time-indexed
assumption. Required to evaluate the strategy from *The Forex Scalping Strategy*.
Keep it in mind when designing; do not build it yet.

### Further data sources

To be added as indicators need them, not before: `orderBookL2`,
`instrument`/`compositeIndex`, funding, insurance. Each lands in the same
`<symbol>/parquet/<table>/<year>.parquet` shape, so the reader needs no changes.

`orderBookL2` carries the pool complication in its sharpest form — it had an
`Aggregated` period unioning both pools indistinguishably. See
[../DATA.md](../DATA.md).

## Superseded artifacts still on disk

Not deleted, pending an explicit call:

- `<symbol>/parquet/bins1m.parquet`, `bins5m.parquet` — single whole-history
  files, replaced by `tradeBin1m/<year>.parquet`.
- `XBTUSD/{trade,quote}.YYYY-*.csv` — ~228 GB of intermediates from the retired
  extract-then-convert path. Every row is in the dataset, all symbols, all
  columns.
- `parquet-import.json.superseded` — the single-file manifest, replaced by
  `manifest/`.

## Open questions

- **Trade timestamps are `VARCHAR`, quote timestamps are `TIMESTAMPTZ`.** An
  inherited inconsistency, harmless so far but worth settling before the API
  hardens around either.
- The barrier-predictor work in [../proposals/BARRIER-PREDICTOR.md](../proposals/BARRIER-PREDICTOR.md)
  is blocked on label generation from ticks, not bins: at X = 0.15–0.5% both
  barriers routinely fall inside one minute's high–low range, and 1m OHLC cannot
  say which was touched first — which is the entire label.
