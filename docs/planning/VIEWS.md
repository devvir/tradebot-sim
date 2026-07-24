# Views

A **view** is a derived rendering of data already held — computed on the fly,
never cached, but needing its own space and its own controls.

It is a third kind of thing alongside indicators and candles, and it earns that
status by being unlike both:

- an **indicator** is a series: one value per bar, expensive to compute, cached
  once and read forever;
- a **view** is a *transform of what is already on screen*: trivially derived
  from candles plus an already-cached series, so caching it would store data we
  can regenerate in a frame.

Calling a view an indicator would mean caching something with no reason to be
cached, and would put entries in the indicator registry that are not series at
all. Making it a candle mode (like Heikin-Ashi) would mean never seeing it
alongside the normal chart, which is precisely when it is useful.

## First view: detrended candles

OHLC bars translated vertically so a chosen moving average is flat. Each
candle's four prices are shifted by the average at that bar, leaving what price
did *relative to its trend* — the same reason one looks at residuals rather than
a fitted line.

**Always proportional. There is no absolute mode, and no scale control.**

Each price is divided by the average at that bar, giving deviation centred on 1
and plotted on a log axis — equivalently `log(price) − log(MA)` on a linear one.

Absolute deviation is not offered because it is not meaningful here. XBTUSD has
ranged from ~$200 to ~$100k, so a $50 deviation is enormous in 2015 and noise in
2024; only the proportional form is comparable across the history, which is the
entire reason to detrend. A subtractive form would need a symmetric-log axis to
render at all (it straddles zero) and would still not be comparable — so it buys
a control and answers nothing.

## What a view owns

Views need per-view options, which is most of why they are their own concept:

- **average type** — MA, EMA, and whatever else later;
- **period** — either a fixed number, or **auto**, meaning it tracks the chart's
  current bin size so switching 5m → 4h moves the average with it;
- future views will want their own, unrelated options.

So a `ViewSpec` declares its inputs (the candles at the current bin, plus any
cached series it needs, which depend on the chosen options) and an options
schema the UI can render generically — the same trick that makes adding an
indicator configuration rather than code.

## Reuse, and where it stops

Views share nearly all of the indicator-pane machinery: the collapsible pane,
the header, the shared visible range, the selector. What differs is that a view
takes an options popover, and that its data comes from a transform rather than a
fetch.

The selector already varies on two axes (cardinality × overlayable). Views add a
third catalogue rather than a third axis — the same component, listing views
instead of indicators.

## Open

- **Does a view ever overlay the price chart** rather than take its own pane?
  Detrended candles clearly want their own pane. A future view might not.
- **Auto period** depends on the timeframe-relative indicator work: if the
  average must match the chart's bin, that series has to exist at that bin, or
  be computed on the fly. See [UI.md](UI.md).
- **When a view needs data that is expensive to derive, extract that data as an
  indicator — do not turn the view into one.** Cache the expensive part, and the
  view stays a cheap transform of cached inputs.

  Example: lining candles up inside rectified Bollinger bands. The bands are the
  costly piece, so they become a cached indicator; the view is then just candles
  plus two series, computed per frame like any other.

  This keeps the split clean as views get more ambitious: a view is always cheap
  *because* anything costly it needs has been pulled out in front of it.
