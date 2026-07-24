# tradebot-poc

A bench for trying trading ideas against real historical BitMEX data, fast.

This is not a prototype with an end date. It is the place where a candidate idea
— an indicator, a signal, a whole strategy — gets built, looked at, and judged,
and it stays in use long after any particular strategy is settled.

## The one thing that matters

**Iteration speed is the product.** Every design decision here answers to that.
Anything that makes trying an idea slow is a bug, even when it is otherwise good
engineering: recomputing a series that was already computed, editing ten files
to add one indicator, a UI where a new signal means new plumbing.

Three consequences run through the whole codebase:

- **Compute once, reuse forever.** Every series — indicator, feature, bin — is
  cached on disk. Nothing is recomputed to answer a request.
- **Additive by default.** New data arrives periodically. Every generator
  detects how far it already ran, seeds whatever history it needs, computes only
  the missing tail, and banks it. Re-running is always safe and never redundant.
- **Discovery over enumeration.** Code finds what exists rather than listing it.
  Adding an indicator should approach being a registry entry plus a colour.

## What it does

A strategy is a folder: decision logic plus a settings file. Running one walks
the price forward over cached data, executes the decisions, and accounts for
balance, unrealised PnL and equity as it goes. Every run is logged in full —
settings, range, stats, state progression — so results stay comparable and any
past run can be reloaded and charted. Design:
[docs/planning/STRATEGY-ENGINE.md](docs/planning/STRATEGY-ENGINE.md).

## Layers

| layer | package | what it owns |
| --- | --- | --- |
| domain | `core` | Types, indicator math, the simulation engine. Pure — no I/O, no node builtins, safe to import from the browser. |
| data | `data` | Importers, precompute, the dataset reader, and the `poc` CLI. Builds and owns everything on disk. |
| api | `server` | Serves the dataset and the UI. Reads; never generates. |
| ui | `web` | The chart and the indicator panels. |

Dependencies point one way: `web` → `server` → `data` → `core`. The API never
builds data; the UI never reads the disk.

Deeper detail per layer lives in [docs/](docs/) — [DATA.md](docs/DATA.md),
[API.md](docs/API.md), [UI.md](docs/UI.md). Work in progress and things not yet
built live in [docs/planning/](docs/planning/).

## Getting around

```bash
pnpm poc --help          # data layer: import, precompute, extract
pnpm serve               # api layer
pnpm web                 # ui layer
pnpm -r typecheck        # all packages
```

Long-running jobs are never launched directly — see [scripts/README.md](scripts/README.md)
for the capped-launch rule and why every job is chunked and banked.

## House rules

- **Nothing is deleted without being asked.** Cached indicators and series are
  expensive; pruning them is the user's call, made explicitly, never an agent's
  judgement call about what looks obsolete.
- **Measure before claiming.** Performance causes are established by benchmark,
  not by reasoning about them. Several confident diagnoses in this project's
  history were disproved by a five-minute measurement.
- **Verify against ground truth.** An import that "ran" proves nothing. Row
  counts are checked against the source.
- **Types live in `types.ts`.** Every type, in the nearest one. No exceptions.
- Semicolons; `if (! x)` with the space; blank lines around logical blocks;
  exported functions first, helpers after.
