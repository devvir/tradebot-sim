# API layer

Serves the dataset and the UI. It reads; it never generates. If a request would
require computing a series, that is a bug — the series should have been
precomputed by the data layer.

Package: `server`. Depends on `data` for config and the dataset reader.

## The rule that shapes everything

**Adding an indicator must not require touching the API.**

The API therefore never enumerates indicators. It asks the registry what exists
and asks the dataset reader what is cached, and serves the intersection. A new
indicator appears in the UI because it appeared in the registry and its cache
file landed — no endpoint, no route, no mapping table.

The same applies to tables and symbols: both are discovered from the directory
layout (`listSymbols`, `listTables`), never from a hardcoded list.

## Endpoints

Discovery:

```
GET /api/symbols                    every symbol with data
GET /api/symbols/:symbol/tables     tables present + years covered
GET /api/indicators                 registry ∩ cache, with display metadata
```

Series:

```
GET /api/candles?symbol&from&to&bin        OHLCV, aggregated to the requested bin
GET /api/indicator/:id?symbol&from&to      one cached series [t, v]
```

Every series response carries the resolution it actually served, which will not
always be the one requested — see aggregation below.

## Indicator metadata is the contract

The registry entry is what both layers agree on. `IndicatorSpec` already carries
what the UI needs to render without special-casing:

| field | use |
| --- | --- |
| `id` | cache filename and request key |
| `label` | what the user sees |
| `family` | grouping in the selector (21 families today) |
| `tf` | primary timeframe |
| `pane` | `price` overlays the candle chart; any other value names its own pane |
| `kind` | how to draw it |
| `color`, `defaultVisible` | display defaults |

`pane === 'price'` is exactly the overlayable/non-overlayable split the UI's
selector needs — 15 indicators overlay, 40 occupy 24 distinct sub-panes. The UI
filters on this field; it does not maintain its own list.

Boolean, gate-style series (rendered as a thin two-colour ribbon rather than a
curve) are a `kind`, so they route by the same mechanism.

## Aggregation

Candles are cached at 1m (plus 5m, 1h, 1d imported directly). Larger bins are
composed on request — cheap, since composition is a group-by over an already
minute-aligned series, and the 1h/1d tables exist precisely so that weekly and
monthly views do not sum millions of rows.

**Smaller than the finest cached bin is impossible.** A request below the floor
is refused, not silently upsampled; the response states the resolution served so
the UI can show what it is actually looking at.

## What it is not

- Not a place for strategy logic — that is `core`.
- Not a place for generation — that is `data`, behind its CLI.
- Not multi-user. Single user, read-only, localhost.
