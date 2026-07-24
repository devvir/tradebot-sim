# UI vision

The whole point of the UI is to look at a new idea fast. Adding an indicator
should eventually be **configuration only** — where it renders, its known
behavior, its colors — never a code change across many files.

## Page layout — four areas, top to bottom

1. **Featured indicator** — one canvas for the indicator currently under
   analysis. Collapsible. Single-select. When nothing is selected the *selector
   still shows* (the canvas does not); picking one reveals the canvas.
2. **Candle chart** — the main area. Overlay indicators (moving averages, bands)
   draw on top of it, chosen from a popup button on the chart itself.
3. **Boolean indicator bar** — gate-style on/off series as a narrow strip of two
   alternating colors, **5–20 px tall**. Sits between the chart and the bottom
   area. Deliberately small; it is a status ribbon, not a panel.
4. **Common indicators** — as many canvases as are selected, stacked.
   Multi-select, collapsible. Some indicators live here semi-permanently, but
   **nothing is hardcoded** — the user adds and removes them at will.

## Component reuse — this is the point, not an optimization

- **Areas 1 and 4 are the same component.** The featured area is one instance;
  the bottom area is a list of instances. Do not write them twice.
- **One selector component, two independent modes:**
  - *cardinality* — single-select (featured) or multi-select (bottom);
  - *filter* — lists either **non-overlayable** indicators (areas 1 and 4) or
    **overlayable** ones (the chart popup).
  The chart's overlay popup is that same component, in overlayable mode.

Indicators therefore need to declare, in their registry entry, whether they are
overlayable, non-overlayable, both, or boolean — the UI reads that and routes
them. Some indicators have **both** representations (a gate is a boolean bar
*and* a translucent background band on the chart).

## Candle chart controls

**Candle type** — a selector, extensible:
- regular OHLC;
- **Heikin-Ashi** — derived on the fly from regular OHLC (each candle needs only
  the previous HA candle, so it streams; no precomputed bins needed unless
  profiling later says otherwise);
- future types slot into the same selector.

**Bin size** — `Auto` (current behavior: zoom level picks the bin size) plus
explicit buttons that pin the size regardless of zoom:
`1s, 1m, 5m, 15m, 30m, 1h, 4h, 12h, 1D, 3D, 1W, 1M`.

**Bins compose upward only.** A 1m bin builds 5m/15m/30m/1h on the fly; nothing
builds a bin *smaller* than its source. Consequences:
- the `1s` button requires **1s bins to exist** — they are not in Mongo and must
  be generated from the trade ticks (see below);
- `1h` and `1d` are pre-imported from Mongo so 1W/1M/3D aggregate cheaply
  instead of summing millions of 1m bins.

## State persistence

Visible range, candle type, bin size, featured selection, bottom selections,
overlay selections, and collapse states all survive a refresh (localStorage or
equivalent). A reload must not reset the workspace.

Zoom is **shared state**: re-ranging the chart re-ranges every linked panel.
This is the one piece of genuinely global UI state — give it a proper store, not
prop-drilling.

## Volume bars

A volume sub-area at the bottom of the candle pane, taking a share of its
vertical space — start at **20%, configurable** — so the candles give up height
to it rather than it floating over them.

- **Height is proportional to volume, self-scaled to the viewport.** The tallest
  bar in the visible range fills the area; scaling follows the window, not the
  whole history, so quiet stretches stay readable.
- **The losing side draws as an overlay from the bottom.** A bar of total volume
  100 with 20 buys renders full height in the sell colour, with the bottom 20%
  in semi-transparent buy colour. One bar per candle, two pieces.
- Other layouts (side-by-side, diverging from a centre line, plain single-colour)
  may look better. Treat the above as the first thing to try, not the answer.

**Data dependency, the only real one here:** the candle endpoint returns total
volume only — `tradeBin*` carries `volume` with no side breakdown. The split
already exists as precomputed features, `tf_buyvol_1m` and `tf_sellvol_1m`, so
this is a matter of serving them alongside candles (or letting the chart request
them as a paired series), not of computing anything new. At bins coarser than
1m they aggregate by summing, like the candles do.

**The volume area is a pane.** It looks like part of the chart, but it is its
own pane in a fixed position embedded within it. That framing costs nothing new:
volume-family series (volume EMAs among them) overlay it by declaring
`pane: 'volume'`, which the existing metadata already expresses — no new routing
concept, no special case in the chart component. It differs from the featured
and common panes only in being pinned inside the chart rather than stacked
outside it, and in overlaying bars rather than owning an empty canvas.

**Keep the rendering decision in one place.** How a volume bar looks must be
changeable without touching the chart, the API, the store and the layout. The
sub-area should be its own renderer taking `(candles, buyVolume, sellVolume,
box)` and owning nothing else, so swapping the style is one file — the same
reason the indicator panes and selectors are single components reused
everywhere.

## Indicator menu at scale

Fifty indicators today, plausibly hundreds later. A single scrolling column
stops working well before that.

- **Use the horizontal space: multiple columns, grouped by family**, laid out so
  related series sit together rather than wrapping arbitrarily. The families
  already exist in the registry metadata (21 of them today) — group on that, do
  not invent a second taxonomy.
- **Favorites, with a star per row** on the right of each entry: hollow when
  unset, yellow when set, clicking toggles it. Favorites persist with the rest
  of the workspace state.
- **Two tabs: Favorites and All.** Same view, same component — the only
  difference is that Favorites hides the unstarred. **Favorites is the default**,
  so the common case opens straight to a short list, and finding something new
  means opening the menu and switching to All.

The star lives on the row in both tabs, so a series can be starred or unstarred
from wherever it is seen.

This stays one component. Tabs and columns are presentation over the same
filtered list the selector already builds; the cardinality and overlay-filter
axes are unchanged.

## Timeframe-relative indicators — needs real planning

Today an indicator's timeframe is baked into its id (`ema_200_1m`), and the
chart draws whatever was asked for regardless of the bin the candles are on.
Two behaviours are wanted, and they are different:

1. **Pinned timeframe.** Overlay the 1m EMA-200 while viewing 4h candles. This
   is genuinely useful — a fast average against a slow view — and it works today
   as long as the series is aligned to the displayed buckets.
2. **Auto-matching timeframe.** A generic MA/EMA that follows the view: switch
   the candles from 5m to 4h and the average recomputes on 4h. This does not
   exist and is the interesting one.

### Why (2) is not free

Auto-matching means the indicator must be available at *every* bin size the
chart offers, which is 11 today. Two ways to get there, and the right answer is
probably per-indicator:

- **Cache every size.** Storage and precompute cost multiply by the number of
  sizes; simple to serve, expensive to maintain, and hostile to the
  "computed once" principle when most sizes are rarely looked at.
- **Compute for the viewport on the fly.** Drawing needs only the visible bars —
  a few hundred — so aggregating cached fine bins up to the view's size and
  running the indicator over them is cheap. It reads back by the
  indicator's warmup, which is a handful of extra bars.

A distinction worth getting right early: **a coarse indicator is not derivable
from its own fine version.** A 4h EMA is not any function of the 1m EMA — it has
to be computed from 4h *bins*. What composes upward is the bins, never the
stateful series built on them. Some indicators (counts, sums, volume) do
aggregate directly; most of the interesting ones (EMA, RSI, ATR, STC) do not.

### Precompute is the rule, on-the-fly is the fallback

"Never compute an indicator on demand" is a rule of thumb, not an absolute.
Precomputing every indicator at every bin size is its own kind of waste — most
combinations will never be looked at.

The intended shape:

- **Precompute everything we know we will want.** That stays the default and is
  what keeps runs and common views fast.
- **Fall back to computing on the fly when a series is not cached.** Treat it as
  the rare path, not a design compromise.
- **Say so when it happens** — a toast or console notice that this series was
  computed live rather than read from cache. If the same fallback keeps
  appearing, that is the signal to precompute it and be done; the fix is one
  precompute run, not an architecture change.

This must not be confused with the strategy-engine rule. The engine forbids
computing inside the run loop because a run walks years and per-step computation
destroys the speed argument. That is about **runs**, not **drawing**: a few
hundred bars for a visible window is a different problem with a different
budget, and forcing one answer onto both would make either the chart rigid or
the runs slow.

### What makes the fallback cheap

Indicators are **not** database pipelines. `IndicatorSpec.compute` is a pure
TypeScript function `(bins: Bin1m[]) => (number | null)[]`, and it lives in
`core` — the package with no I/O and no node builtins, already imported by the
browser.

So the same function serves both paths with no second implementation: batch
precompute feeds it years of bins server-side; the on-the-fly path feeds it the
few hundred bins the chart already holds, client-side. Whether the fallback runs
in the browser or in the API is then a deployment choice, not an architectural
one.

A generator asked for N bars simply requests N + its own warmup and returns the
N. This is server-side arithmetic; the UI never sees it. One thing to fix while
passing: the precompute's `OVERLAP_DAYS = 30` is expressed in days, which stops
being right once indicators run on coarse bins — warmup belongs in bars so it
scales with the bin.

Record per indicator whether it is aggregable and whether auto-matching is
offered, so the chart and the API stay generic. Still an open question, not a
settled design.

## Planned, not now

### 1-second trade bins

Wanted for finer aggregation (30s and below) and, more importantly, **fill
simulation accuracy** — not primarily for display. Must be generated from the
trade tick Parquet; Mongo has only 1m/5m/1h/1d. Once they exist, every larger
bin can be composed from them.

### Tick-based candles

A paradigm change, not another candle type: bins closed by a fixed **number of
trades** rather than by elapsed time. Required to test the strategy from *The
Forex Scalping Strategy*, which the user intends to evaluate on this platform.
Needs its own bin generation over the trade ticks and a rethink of every
time-indexed assumption in the chart and the indicator cache (the x-axis stops
being uniform time). **Keep it in mind when designing; do not build it yet.**
