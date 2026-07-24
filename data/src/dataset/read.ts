import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { binSpec, symbolDir, symbolsRoot } from '@poc/core';

import type { DuckDBConnection } from '@duckdb/node-api';
import type { Bin1m, DatasetTable, PocConfig } from '@poc/core';

/**
 * The one way to read the dataset.
 *
 * Everything downstream — precompute, the API, any experiment — goes through
 * here rather than building paths of its own. The layout is uniform by
 * construction: <pocDir>/symbols/<L>/<symbol>/parquet/<table>/<year>.parquet
 * for every table (see `symbolDir`), so a reader only ever needs a symbol and a
 * table name, and adding a table costs no new reader code.
 */

/** All symbols that have any data, from the directory layout alone. */
export function listSymbols(config: PocConfig): string[] {
  const root = symbolsRoot(config);

  if (! existsSync(root)) {
    return [];
  }

  /** symbols/<bucket>/<symbol> — two levels, bucket dirs then symbol dirs. */
  return readdirSync(root, { withFileTypes: true })
    .filter((b) => b.isDirectory())
    .flatMap((b) => readdirSync(join(root, b.name), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name))
    .filter((symbol) => existsSync(join(symbolDir(config, symbol), 'parquet')))
    .sort();
}

/** Tables present for a symbol, with the years each covers. Pure discovery — no schema knowledge. */
export function listTables(config: PocConfig, symbol: string): DatasetTable[] {
  const dir = join(symbolDir(config, symbol), 'parquet');

  if (! existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      years: readdirSync(join(dir, e.name))
        .filter((f) => f.endsWith('.parquet'))
        .map((f) => f.slice(0, 4))
        .filter((y, i, all) => all.indexOf(y) === i)
        .sort(),
    }))
    .filter((t) => t.years.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Glob for a table's year files, or undefined when the symbol has no such table. */
export function tableGlob(config: PocConfig, symbol: string, table: string): string | undefined {
  const dir = join(symbolDir(config, symbol), 'parquet', table);

  return existsSync(dir) ? join(dir, '*.parquet') : undefined;
}

/** Latest timestamp in a table, as an ISO string, or null when empty/absent. */
export async function maxTimestamp(
  conn: DuckDBConnection,
  config: PocConfig,
  symbol: string,
  table: string,
  column = 'timestamp',
): Promise<string | null> {
  const glob = tableGlob(config, symbol, table);

  if (! glob) {
    return null;
  }

  const reader = await conn.runAndReadAll(
    `SELECT strftime(max(${column}), '%Y-%m-%dT%H:%M:%S.000Z') AS m FROM read_parquet('${glob}')`,
  );
  const value = reader.getRows()[0]?.[0];

  return value == null ? null : String(value);
}

/** Earliest timestamp in a table, as an ISO string, or null when empty/absent. */
export async function minTimestamp(
  conn: DuckDBConnection,
  config: PocConfig,
  symbol: string,
  table: string,
  column = 'timestamp',
): Promise<string | null> {
  const glob = tableGlob(config, symbol, table);

  if (! glob) {
    return null;
  }

  const reader = await conn.runAndReadAll(
    `SELECT strftime(min(${column}), '%Y-%m-%dT%H:%M:%S.000Z') AS m FROM read_parquet('${glob}')`,
  );
  const value = reader.getRows()[0]?.[0];

  return value == null ? null : String(value);
}

/**
 * Load bins for [from, to) as the shape the indicator layer expects.
 *
 * Year files are pruned by the glob's Parquet statistics, so a narrow window
 * touches only the years it spans — an additive tail run does not pay for the
 * whole history.
 */
export async function loadBins(
  conn: DuckDBConnection,
  config: PocConfig,
  symbol: string,
  from: string | undefined,
  to: string | undefined,
  interval = '1m',
): Promise<Bin1m[]> {
  const glob = tableGlob(config, symbol, `tradeBin${interval}`);

  if (! glob) {
    return [];
  }

  /**
   * Bounds are optional: an absent one means "no limit", expressed by omitting
   * the predicate rather than by a sentinel string. Sentinels like '0000' work
   * only while timestamps are text — they became a parse error the moment the
   * column got a real type.
   */
  const where: string[] = [];

  if (from) {
    where.push(`timestamp >= TIMESTAMP '${from}'`);
  }

  if (to) {
    where.push(`timestamp < TIMESTAMP '${to}'`);
  }

  const reader = await conn.runAndReadAll(
    `SELECT strftime(timestamp, '%Y-%m-%dT%H:%M:%S.000Z') AS t,
            open, high, low, close, trades, volume, vwap
     FROM read_parquet('${glob}')
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY timestamp`,
  );

  return reader.getRows().map((row) => ({
    t: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    trades: Number(row[5]),
    volume: Number(row[6]),
    vwap: Number(row[7]),
  }));
}

/**
 * Load bars aggregated to an arbitrary ladder timeframe from its nearest cached
 * base (BIN_LADDER), as the same `Bin1m` shape the indicator layer consumes.
 *
 * This is the single bin→bin aggregator: end-labelled ceil-bucketing (a bar
 * stamped 11:15 closes the bucket ending 11:15), identical to how the server
 * composes candles, so an indicator computed here lines up bar-for-bar with what
 * the UI draws. `1W`/`1M` are calendar buckets, never fixed minute counts.
 *
 * A size whose source is its own base (1m←tradeBin1m, …) is an identity
 * group-by. Passing a sub-minute size reads the generated 1s floor; passing a
 * long one reads the daily base — so a `1W` series touches ~thousands of daily
 * bars, never millions of minutes.
 */
export async function loadBars(
  conn: DuckDBConnection,
  config: PocConfig,
  symbol: string,
  tf: string,
  from: string | undefined,
  to: string | undefined,
): Promise<Bin1m[]> {
  const spec = binSpec(tf);

  if (! spec) {
    throw new Error(`unknown bin size: ${tf}`);
  }

  const glob = tableGlob(config, symbol, spec.source);

  if (! glob) {
    return [];
  }

  const where: string[] = [];

  if (from) {
    where.push(`timestamp >= TIMESTAMP '${from}'`);
  }

  if (to) {
    where.push(`timestamp < TIMESTAMP '${to}'`);
  }

  const bucket = `time_bucket(INTERVAL '${spec.interval}', timestamp - INTERVAL 1 microsecond) + INTERVAL '${spec.interval}'`;
  const reader = await conn.runAndReadAll(
    `SELECT strftime(bucket, '%Y-%m-%dT%H:%M:%S.000Z') AS t,
            first(open ORDER BY timestamp) AS open, max(high) AS high, min(low) AS low,
            last(close ORDER BY timestamp) AS close, sum(trades) AS trades, sum(volume) AS volume,
            sum(vwap * volume) / nullif(sum(volume), 0) AS vwap
     FROM (SELECT ${bucket} AS bucket, *
           FROM read_parquet('${glob}')
           ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''})
     GROUP BY bucket ORDER BY bucket`,
  );

  return reader.getRows().map((row) => ({
    t: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    trades: Number(row[5]),
    volume: Number(row[6]),
    vwap: Number(row[7]),
  }));
}
