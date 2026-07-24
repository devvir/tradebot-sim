import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { BIN_LADDER, BIN_SIZES, INDICATORS, symbolDir } from '@poc/core';
import { tableGlob } from '@poc/data';

import type { DuckDBConnection } from '@duckdb/node-api';
import type { ApiCandle, ApiIndicator, ApiPoint, PocConfig } from '@poc/core';

/**
 * Reading the dataset for the UI. Nothing here computes a series: if it is not
 * cached, it is not served. Aggregation to a coarser bin is the one exception,
 * and it is a group-by over already-aligned rows. The bin ladder (sizes, bucket
 * intervals, source bases) is the shared `BIN_LADDER` from core.
 */

export function binSizes(): string[] {
  return BIN_SIZES;
}


/**
 * Indicators the UI may render: registered AND cached for this symbol.
 *
 * Discovery, not enumeration — a new indicator appears here because its spec
 * exists and its cache landed. Files starting with `_` are precompute scratch
 * (a killed run leaves zero-byte `_wide_*` behind) and are never served.
 *
 * This reads the directory and nothing else. It must never query the data: it
 * answers "what exists", which the filesystem already knows.
 */
export function listIndicators(config: PocConfig, symbol: string): ApiIndicator[] {
  const dir = join(symbolDir(config, symbol), 'indicators');

  if (! existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.parquet') && ! f.startsWith('_'));

  if (files.length === 0) {
    return [];
  }

  const cached = new Set(files.map((f) => f.slice(0, -'.parquet'.length)));

  const out: ApiIndicator[] = [];

  for (const spec of INDICATORS) {
    if (! cached.has(spec.id)) {
      continue;
    }

    out.push({
      id: spec.id,
      label: spec.label,
      family: spec.family,
      tf: spec.tf,
      pane: spec.pane,
      kind: spec.kind,
      color: spec.color,
      defaultVisible: spec.defaultVisible,
      overlay: spec.pane === 'price',
      cached: spec.cached,
    });
  }

  return out;
}

/** OHLCV aggregated to `bin`. Composition only ever goes upward from a cached source. */
export async function candles(
  conn: DuckDBConnection,
  config: PocConfig,
  symbol: string,
  from: string,
  to: string,
  bin: string,
): Promise<ApiCandle[]> {
  const spec = BIN_LADDER[bin];

  if (! spec) {
    throw new Error(`unknown bin size: ${bin}`);
  }

  const glob = tableGlob(config, symbol, spec.source);

  if (! glob) {
    throw new Error(`${symbol} has no ${spec.source} data`);
  }

  /**
   * BitMEX END-labels bins: a stamp marks the interval's close (11:10 covers
   * [11:05, 11:10)). Flooring stamps into buckets therefore grabs one bin of
   * the previous window and drops the last — so bucket by ceiling instead:
   * (stamp − 1µs) floored, plus one interval, labelled by the bucket's end.
   * Verified to reproduce native tradeBin5m exactly.
   */
  const bucket = `time_bucket(INTERVAL '${spec.interval}', timestamp - INTERVAL 1 microsecond) + INTERVAL '${spec.interval}'`;
  const rows = await queryRows(
    conn,
    `SELECT strftime(bucket, '%Y-%m-%dT%H:%M:%S.000Z') AS t,
            first(open ORDER BY timestamp) AS o, max(high) AS h, min(low) AS l,
            last(close ORDER BY timestamp) AS c, sum(volume) AS v
     FROM (SELECT ${bucket} AS bucket, *
           FROM read_parquet('${glob}')
           -- end-labelled stamps: range is (from, to] — the bin stamped exactly
           -- at 'from' closed before the window begins
           WHERE timestamp > '${from}' AND timestamp <= '${to}')
     GROUP BY bucket ORDER BY bucket`,
  );

  return rows.map((r) => ({
    t: String(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[5]),
  }));
}

/**
 * One cached indicator series, aligned to the same buckets as the candles.
 *
 * The bucket's value is its LAST point, matching how a candle takes its close —
 * so an overlay lines up with the bar it is drawn on.
 */
export async function indicatorSeries(
  conn: DuckDBConnection,
  config: PocConfig,
  symbol: string,
  id: string,
  from: string,
  to: string,
  bin: string,
): Promise<ApiPoint[]> {
  const spec = BIN_LADDER[bin];

  if (! spec) {
    throw new Error(`unknown bin size: ${bin}`);
  }

  /** Guard the path: ids come from the request. */
  if (! /^[a-z0-9_.-]+$/i.test(id)) {
    throw new Error(`bad indicator id: ${id}`);
  }

  const path = join(symbolDir(config, symbol), 'indicators', `${id}.parquet`);

  if (! existsSync(path)) {
    throw new Error(`${id} is not cached for ${symbol} — precompute it first`);
  }

  /** Same end-label ceil-bucketing as candles() — they must move together or overlays misalign. */
  const bucket = `time_bucket(INTERVAL '${spec.interval}', t - INTERVAL 1 microsecond) + INTERVAL '${spec.interval}'`;

  /**
   * Cached series are step functions — a row marks a change, and the value
   * holds until the next one. So the newest row at or before the window start
   * must come too, or a slow series whose last change predates the window
   * returns nothing and the line vanishes. It is re-stamped to the window start
   * so the consumer sees a value from the first bar.
   */
  const rows = await queryRows(
    conn,
    `WITH carry AS (
       SELECT TIMESTAMP '${from}' AS t, v FROM read_parquet('${path}')
       WHERE t <= TIMESTAMP '${from}' ORDER BY t DESC LIMIT 1
     ), win AS (
       SELECT t, v FROM read_parquet('${path}')
       WHERE t > TIMESTAMP '${from}' AND t <= TIMESTAMP '${to}'
     )
     SELECT strftime(bucket, '%Y-%m-%dT%H:%M:%S.000Z') AS t, last(v ORDER BY t) AS v
     FROM (SELECT ${bucket} AS bucket, t, v FROM (SELECT * FROM carry UNION ALL SELECT * FROM win))
     GROUP BY bucket ORDER BY bucket`,
  );

  return rows.map((r) => ({ t: String(r[0]), v: r[1] == null ? null : Number(r[1]) }));
}

async function queryRows(conn: DuckDBConnection, sql: string): Promise<unknown[][]> {
  const reader = await conn.runAndReadAll(sql);

  return reader.getRows() as unknown[][];
}
