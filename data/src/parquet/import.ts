import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { bankChunk, openDataset, readManifest } from './dataset';
import { partitionBySymbol } from './partition';

import type { ImportOptions, ImportYearResult, PocConfig } from '@poc/core';

/** Must exceed the per-year symbol count, or the writer splits partitions. */
const MAX_OPEN_FILES = 400;

/**
 * Explicit schemas: a fixed column list plus null_padding normalizes every year
 * to one shape, so a year glob never hits a schema mismatch.
 *
 * Timestamps are plain `TIMESTAMP`, never `TIMESTAMPTZ`. Everything in this
 * project is UTC, and the zone-aware type renders and converts against the
 * *session* timezone — on a machine set to +04 it silently shifts values by four
 * hours unless every reader remembers `SET TimeZone='UTC'`. The source strings
 * are Z-suffixed ISO, which casts to the correct UTC wall clock directly. BitMEX has widened
 * these files twice — `trdType` partway through 2022, and `pool` on 2026-04-16
 * (quote: 2026-04-14). Older rows are short, so positional mapping leaves the
 * trailing columns NULL.
 */
const TRADE_COLUMNS = {
  timestamp: 'TIMESTAMP',
  symbol: 'VARCHAR',
  side: 'VARCHAR',
  size: 'BIGINT',
  price: 'DOUBLE',
  tickDirection: 'VARCHAR',
  trdMatchID: 'VARCHAR',
  grossValue: 'BIGINT',
  homeNotional: 'DOUBLE',
  foreignNotional: 'DOUBLE',
  trdType: 'VARCHAR',
  pool: 'VARCHAR',
};

const QUOTE_COLUMNS = {
  timestamp: 'TIMESTAMP',
  symbol: 'VARCHAR',
  bidSize: 'BIGINT',
  bidPrice: 'DOUBLE',
  askPrice: 'DOUBLE',
  askSize: 'BIGINT',
  pool: 'VARCHAR',
};

/**
 * BitMEX introduced liquidity pools for selected symbols in mid-April 2026;
 * quote, trade and orderBookL2 rows now each belong to one. The pools cannot be
 * mixed — a simulation summing both double-counts a book that never existed as
 * a whole — so the dataset keeps the Primary pool only. Rows predating the
 * rollout have no pool at all and are kept as-is.
 *
 * Secondary is dropped deliberately, on instruction. It remains recoverable
 * from cold storage if it is ever wanted.
 *
 * `pool` is read so it can be filtered on, then EXCLUDEd from the output: every
 * surviving row is Primary-or-pre-rollout, so storing the column would say
 * nothing. Dropping it also keeps the post-rollout years schema-identical to
 * the years imported before pools existed.
 */
const PRIMARY_ONLY = `pool IS NULL OR pool = 'Primary'`;

/**
 * Import the raw all-symbol daily gzips into the per-symbol Parquet dataset.
 *
 * Reads <pocDir>/raw/<table>/<year>/YYYYMMDD.csv.gz directly — no intermediate
 * CSV — and routes every symbol in one pass, landing each as
 * <pocDir>/<symbol>/parquet/<table>/<year>.parquet. That makes the dataset
 * self-contained and one-symbol-at-a-time, so the raw gzips become disposable.
 *
 * Work is chunked by (table, year) and banked in the manifest as each chunk
 * lands: a crash costs one year, never the run (HANDOFF §1).
 */
export async function importRaw(config: PocConfig, opts: ImportOptions): Promise<ImportYearResult[]> {
  const manifest = readManifest(config);
  const results: ImportYearResult[] = [];
  const { conn, close } = await openDataset(config);

  for (const table of opts.tables) {
    const tableDir = join(config.pocDir, 'raw', table);

    if (! existsSync(tableDir)) {
      console.log(`${table}: no raw dir, skipped`);
      continue;
    }

    const years = readdirSync(tableDir)
      .filter((y) => /^\d{4}$/.test(y))
      .filter((y) => opts.years.length === 0 || opts.years.includes(y))
      .sort();

    for (const year of years) {
      const key = `${table}/${year}`;

      if (manifest[key] && ! opts.force) {
        console.log(`${key}: done (${manifest[key].rows} rows, ${manifest[key].symbols} symbols), skip`);
        continue;
      }

      const files = readdirSync(join(tableDir, year))
        .filter((f) => f.endsWith('.csv.gz'))
        .filter((f) => ! opts.until || f.slice(0, 8) <= opts.until)
        .sort()
        .map((f) => join(tableDir, year, f));

      if (files.length === 0) {
        console.log(`${key}: no files in range, skip`);
        continue;
      }

      const started = Date.now();

      console.log(`${key}: ${files.length} days → partitioning…`);

      const { symbols, rows } = await partitionBySymbol(
        conn,
        config,
        table,
        year,
        selectFor(table, files),
        MAX_OPEN_FILES,
      );
      const seconds = Math.round((Date.now() - started) / 1000);

      console.log(`${key}: ${symbols} symbols, ${rows} rows, ${seconds}s`);

      manifest[key] = { table, year, symbols, rows, seconds };
      bankChunk(config, manifest[key]);
      results.push(manifest[key]);
    }
  }

  close();
  console.log('done');

  return results;
}

/**
 * Trade rows carry `seq`, the exchange's own ordering.
 *
 * 74% of trades share a millisecond with another, and a sweeping market order
 * fills across several prices inside one — so `last(price ORDER BY timestamp)`
 * picks arbitrarily among ties and gets the bar's close wrong. Raw file order
 * IS exchange order (it reproduces BitMEX's own 1m closes 99.96% of the time
 * vs 96.06% for timestamp-only), but relying on physical row order is not
 * deterministic under parallel scans. Capturing it as a column makes every
 * derived bar exact and every run reproducible.
 *
 * `preserve_insertion_order=true` is required for the row numbering to mean
 * anything, and INTEGER rather than BIGINT halves a column that delta-encodes
 * to almost nothing.
 */
function selectFor(table: string, files: string[]): string {
  const base = `SELECT * EXCLUDE (pool) FROM ${readExpr(table, files)} WHERE ${PRIMARY_ONLY}`;

  if (table !== 'trade') {
    return base;
  }

  return `SELECT * EXCLUDE (pool), CAST(row_number() OVER () AS INTEGER) AS seq
          FROM ${readExpr(table, files)} WHERE ${PRIMARY_ONLY}`;
}

function readExpr(table: string, files: string[]): string {
  const list = files.map((f) => `'${f}'`).join(', ');
  const columns = Object.entries(table === 'trade' ? TRADE_COLUMNS : QUOTE_COLUMNS)
    .map(([k, v]) => `'${k}': '${v}'`)
    .join(', ');

  return `read_csv([${list}], auto_detect = false, delim = ',', quote = '', escape = '', header = true,
            null_padding = true, columns = {${columns}})`;
}
