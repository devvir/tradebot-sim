# Data layer

Owns everything on disk: importing raw exchange data, generating derived series,
and serving both to the rest of the system through one reader.

Package: `data`. Entry point: `pnpm poc <command>` (`data/src/cli.ts`).

## Layout on disk

Everything lives under `$POC_DIR` (default `/storage/bitmex/scalper-poc`), and
**one shape covers every table**:

```
<POC_DIR>/
  raw/<table>/<year>/YYYYMMDD.csv.gz     consumable working copy of the exchange dailies
  manifest/<table>-<year>.json           one file per completed chunk
  <symbol>/
    parquet/<table>/<year>.parquet       the dataset — zstd, per symbol, per year
    indicators/<id>.parquet              cached series [t TIMESTAMP, v DOUBLE]
    features/<source>/<year>.parquet     resumable per-year feature parts
```

`<table>` is `trade`, `quote`, `tradeBin1m`, `tradeBin5m`, `tradeBin1h`,
`tradeBin1d` — and whatever comes next. The uniformity is the point: a reader
needs only a symbol and a table name, so adding a table costs no reader code.

Symbol directories are created by discovery, not by a list. There are currently
**~850** of them.

### Why per-symbol, per-year

Per-symbol because experiments look at one instrument at a time; the raw dailies
interleave ~164 symbols and force a scan of everything to read one. Per-year
because it is the unit of both restartability and additive top-up: a new month
rewrites one year file, not the history.

## Sources

**Raw dailies** (`raw/`) — all-symbol daily gzips copied from the collection
vault. They are a *working copy*, consumable: once imported, the authoritative
copy is cold storage, not this disk.

**Mongo** — the bin collections (`tradeBin1m/5m/1h/1d`) come from the local
database, not the gzips. Same output shape as everything else.

## Importing

```bash
pnpm poc import       --tables trade,quote --until 20260630
pnpm poc import-bins  --collections tradeBin1m,tradeBin5m,tradeBin1h,tradeBin1d
```

Both read straight from the source into Parquet — no intermediate CSV — and fan
every symbol out in a single pass using DuckDB's `PARTITION_BY (symbol)`, one
year at a time. Partitioning by `(symbol, year)` at once would open
symbols × years files and force the writer to flush and reopen, splintering each
partition; one year at a time keeps it to one file per symbol.

### Chunked and banked

Work is split by `(table, year)`. Each completed chunk is written to
`manifest/<table>-<year>.json` **before the next begins**. Therefore a crash, an
OOM kill or a `systemctl stop` costs one year, never the run; re-running resumes
at the first unbanked chunk; and a monthly top-up is the same command.

The manifest is a *directory of one file per chunk*, never a single document.
Importers run concurrently, and a shared read-modify-write file loses updates:
whichever process reads first wins the write and silently discards the other's
chunks. One file per chunk removes the shared mutable state.

### Schema drift

BitMEX has widened these files twice mid-history: `trdType` appeared partway
through 2022, and `pool` on 2026-04-16 (quote: 2026-04-14). Both importers use an
**explicit column list with `null_padding`**, so short older rows map positionally
and leave the trailing columns NULL. Every year therefore has one shape and a
year glob never hits a schema mismatch.

Sampling the first day of each year does not detect a change that lands in
April. Probe the whole span.

### Liquidity pools

From mid-April 2026 BitMEX assigns quote, trade and orderBookL2 rows to a pool
(`Primary`, `Secondary`; orderBookL2 also had an `Aggregated` period that unions
both indistinguishably). **The pools must not be mixed** — summing them
describes a book that never existed.

The dataset keeps `pool IS NULL OR pool = 'Primary'` and drops the column from
the output: every surviving row is Primary-or-pre-rollout, so storing it would
say nothing, and dropping it keeps post-rollout years schema-identical to the
years imported before pools existed. Secondary is discarded here and remains
recoverable from cold storage.

## Time labels

**Every stamp marks its interval's END** — BitMEX's own convention, kept
uniformly: `tradeBin1m` stamped `11:10:00` covers `[11:09, 11:10)`; a 5m bin
stamped `11:10` covers `[11:05, 11:10)`. Derived series (features, indicators,
API aggregates) all follow it.

Two consequences for anyone writing queries:

- **Aggregate by ceiling, not floor.** `time_bucket(iv, ts)` start-labels and
  builds windows shifted by one source bin. Correct form:
  `time_bucket(iv, ts - INTERVAL 1 microsecond) + iv` — verified to reproduce
  native `tradeBin5m` exactly.
- **`date_trunc` start-labels tick aggregation.** Label with
  `date_trunc('minute', ts) + INTERVAL 1 minute`.

A start-labelled series joined to bins at equal stamps pairs different minutes —
a one-bar lookahead leak. This shipped in the feature caches and was fixed
(shifted +1 minute) on 2026-07-23.

## Reading

`data/src/dataset/read.ts` is the only way to read the dataset. Nothing
downstream builds its own paths.

```ts
listSymbols(config)                          // every symbol with data
listTables(config, symbol)                   // tables present + years covered
maxTimestamp(conn, config, symbol, table)    // how far a table runs
loadBins(conn, config, symbol, from, to)     // bins as the indicator layer wants them
```

Windowed reads are pruned by Parquet row-group statistics, so a narrow range
touches only the years it spans — an additive tail run does not pay for the
whole history.

## Derived series

**Indicators** (`pnpm poc precompute-indicators`, `--all` for every symbol) —
55 registered specs, cached one Parquet per id, uniform
`[t TIMESTAMP, v DOUBLE]`, minute-aligned, end-labelled. The run
is additive: it reads each indicator's cached end, reloads a 30-day warmup
overlap so stateful indicators resume correctly, computes only the tail, and
merges. Newly added indicators compute in full; the rest only top up.

**Features** (`pnpm poc precompute-features`) — 17 microstructure features
(10 trade, 7 quote) aggregated per minute from the tick tables, chunked and
banked per year (parts in `features/<source>/`), end-labelled. Minutes with only
one aggressor side carry NULL for the absent side.

## Bins compose upward only

A 1m bin builds 5m, 15m, 30m and 1h on the fly. **Nothing builds a bin smaller
than its source.** So the finest cached bin sets the floor on every downstream
question, which is why 1-second bins are planned (see
[planning/ROADMAP.md](planning/ROADMAP.md)) — they are not obtainable from the
1m bins already cached, only from the trade ticks.

`tradeBin1h` and `tradeBin1d` are imported rather than derived so that weekly and
monthly aggregation is cheap instead of summing millions of 1m rows.
