# UI layer

The place where an idea gets looked at. Its job is to make a new indicator
visible with as little work as possible — ideally a registry entry and a colour.

Package: `web`. Talks only to the API; never reads disk, never computes a series.

The full product vision, including features not yet built, is in
[planning/UI.md](planning/UI.md). This document is the architecture.

## Areas

Four stacked regions, top to bottom:

1. **Featured indicator** — one sub-pane for whatever is under analysis.
   Single-select, collapsible. With nothing selected the selector still shows and
   the canvas does not.
2. **Candle chart** — the main area. Overlay indicators draw on top of it.
3. **Boolean bar** — gate-style on/off series as a 5–20 px ribbon of two
   alternating colours. A status strip, not a panel.
4. **Common indicators** — a stack of sub-panes, multi-select, collapsible.
   Nothing is hardcoded; the set is whatever the user picked.

## Component reuse is the architecture

Two component identities carry the whole layout:

**`IndicatorPane`** — areas 1 and 4 are the same component. Featured is one
instance; the bottom area is a list of instances. Writing them twice is how this
UI would rot.

**`IndicatorSelector`** — one component, two independent axes:

| axis | values | used by |
| --- | --- | --- |
| cardinality | single / multi | featured / bottom |
| filter | overlayable / non-overlayable | chart popup / panes |

The chart's overlay popup is this same selector in overlayable mode. Overlayable
means `pane === 'price'` on the indicator's registry entry — the UI reads that
field and routes accordingly rather than keeping a list of its own.

An indicator may have **both** representations: a gate is a boolean ribbon *and*
a translucent background band on the chart.

## Chart controls

**Candle type** — a selector: regular OHLC, Heikin-Ashi, and room for more.
Heikin-Ashi derives on the fly from regular OHLC (each candle needs only the
previous HA candle, so it streams); no cached bins required.

**Bin size** — `Auto`, where zoom picks the resolution, plus explicit buttons
that pin it: `1s 1m 5m 15m 30m 1h 4h 12h 1D 3D 1W 1M`. Sizes below the finest
cached bin are disabled rather than silently served coarser data.

## State

Persisted across refresh: visible range, candle type, bin size, featured
selection, bottom selections, overlay selections, collapse states. A reload does
not reset the workspace.

The **visible range is shared state** — zooming the chart re-ranges every linked
panel. This is the one genuinely global piece of UI state and it gets a proper
store. Everything else that can be local stays local.

## Keeping it reviewable

The user reviews this code personally and fixes bugs in it by hand. That makes
readability a hard requirement, not a preference:

- no monster file holding chart + indicators + header + tools + switches;
- components extracted at their natural seams;
- shared state in a store, not prop-drilled through five levels;
- a new indicator should touch configuration, not control flow.
