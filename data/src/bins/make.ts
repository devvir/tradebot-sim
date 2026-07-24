import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs';
import { join } from 'path';

import { bankChunk, openDataset, readManifest } from '../parquet/dataset';
import { listSymbols, tableGlob } from '../dataset/read';

import type { DuckDBConnection } from '@duckdb/node-api';
import { symbolDir } from '@poc/core';
import type { MakeBinsOptions, PocConfig } from '@poc/core';

/**
 * Build bins from trade ticks.
 *
 * Only the finest interval needs generating: bins compose upward, so 1s bins
 * are the floor everything coarser can be aggregated from, and BitMEX supplies
 * 1m and above directly. The reason to want them is fill-simulation accuracy
 * rather than display — knowing whether price actually traded through a level
 * needs finer resolution than a minute.
 *
 * Output matches the imported bin tables column for column, so readers cannot
 * tell the difference between a generated table and an exchange one.
 */
export async function makeBins(config: PocConfig, opts: MakeBinsOptions): Promise<void> {
  const symbols = opts.symbols.length > 0 ? opts.symbols : listSymbols(config);
  const table = `tradeBin${opts.interval}`;
  const manifest = readManifest(config);
  const { conn, close } = await openDataset(config);

  await conn.run(`SET TimeZone='UTC'`);

  let done = 0;

  for (const symbol of symbols) {
    done++;

    const srcDir = join(symbolDir(config, symbol), 'parquet', 'trade');

    if (! tableGlob(config, symbol, 'trade')) {
      continue;
    }

    const outDir = join(symbolDir(config, symbol), 'parquet', table);
    const years = (opts.years.length > 0 ? opts.years : sourceYears(srcDir)).sort();

    mkdirSync(outDir, { recursive: true });

    for (const year of years) {
      const key = `${table}-${symbol}/${year}`;
      const out = join(outDir, `${year}.parquet`);

      if (manifest[key] && ! opts.force && existsSync(out)) {
        continue;
      }

      const src = join(srcDir, `${year}.parquet`);

      if (! existsSync(src)) {
        continue;
      }

      const started = Date.now();
      const tmp = `${out}.tmp`;

      rmSync(tmp, { force: true });
      await conn.run(buildSql(src, tmp, opts.interval));
      renameSync(tmp, out);

      const rows = await countRows(conn, out);
      const seconds = Math.round((Date.now() - started) / 1000);

      console.log(`[${done}/${symbols.length}] ${key}: ${rows} rows, ${seconds}s`);
      bankChunk(config, { table, year, symbols: 1, rows, seconds });
    }
  }

  close();
  console.log('done');
}

/**
 * One aggregation, shaped exactly like an imported bin table.
 *
 * Two details are load-bearing:
 *
 * - **End-labelled.** A stamp marks the interval's close, matching BitMEX and
 *   every other table here, so a bar covering [11:00:00, 11:00:01) is stamped
 *   11:00:01.
 *
 *   Note the bucket formula differs from the one used to aggregate *bins* into
 *   coarser bins. Ticks are points in time, so a trade at exactly 01:09:00.000
 *   STARTS the bar stamped 01:10 — `floor(ts) + iv`. An end-labelled bin
 *   stamped 11:15 instead CLOSES the 15m bucket stamped 11:15, which needs
 *   `floor(ts − 1µs) + iv`. Using the bin formula on ticks misplaces every
 *   boundary-exact trade by one bar (caught by the 60×1s ≡ 1m acceptance test:
 *   4 of 1440 minutes, totals conserved between adjacent pairs).
 * - **Ordered by `seq`, not timestamp.** 74% of trades share a millisecond, and
 *   a sweeping order fills across several prices inside one; ordering by
 *   timestamp picks arbitrarily among those ties and gets `close` wrong.
 *   `seq` is the exchange's own order, captured at import.
 *
 * `open` is the period's first trade rather than the previous bar's close.
 * BitMEX carries the previous close forward, but that couples each bar to the
 * one before it, which would make chunked generation depend on chunk order.
 */
function buildSql(src: string, out: string, interval: string): string {
  const iv = `INTERVAL '${interval === '1s' ? '1 second' : interval}'`;

  return `COPY (
    SELECT
      first(price ORDER BY seq) AS open,
      max(price) AS high,
      min(price) AS low,
      last(price ORDER BY seq) AS close,
      count(*) AS trades,
      sum(size) AS volume,
      last(size ORDER BY seq) AS lastSize,
      sum(grossValue) AS turnover,
      sum(homeNotional) AS homeNotional,
      sum(foreignNotional) AS foreignNotional,
      time_bucket(${iv}, timestamp) + ${iv} AS timestamp,
      sum(price * size) / nullif(sum(size), 0) AS vwap
    FROM read_parquet('${src}')
    GROUP BY 11 ORDER BY 11
  ) TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`;
}

function sourceYears(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}\.parquet$/.test(f))
    .map((f) => f.slice(0, 4))
    .sort();
}

async function countRows(conn: DuckDBConnection, path: string): Promise<number> {
  const reader = await conn.runAndReadAll(`SELECT count(*) FROM read_parquet('${path}')`);

  return Number(reader.getRows()[0][0]);
}
