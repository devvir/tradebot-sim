import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs';
import { join } from 'path';

import { listSymbols, tableGlob } from '../dataset/read';
import { bankChunk, openDataset, readManifest } from '../parquet/dataset';

import { FEATURES } from './registry';

import type { DuckDBConnection } from '@duckdb/node-api';
import type { FeatureSource } from './types';
import { symbolDir } from '@poc/core';
import type { PocConfig } from '@poc/core';

/**
 * Compute a source's microstructure features by aggregating its Parquet into
 * per-minute values.
 *
 * ONE `GROUP BY minute` scan computes every feature of the source at once (the
 * scan is the expensive part), then each is split into the per-indicator cache
 * shape (indicators/<id>.parquet, [t, v]) so the UI treats them identically to
 * the bins indicators.
 *
 * Work is chunked by year and banked as each year lands. This is not a nicety:
 * aggregating the full range as one query is what failed three times, each run
 * SIGTERM'd at the memory cap after hours and returning zero output. One year
 * costs ~235 MB peak RSS and 10–17 s (measured), so chunking bounds the cost
 * regardless of how long the history grows.
 */
/**
 * Features for every symbol that has the source table.
 *
 * Unaffected by the indicator resolution rework (ROADMAP 2f): features are
 * per-minute by definition, so their native resolution is already 1m. Safe to
 * run before it. Resumable — banked chunks are skipped without reading data.
 */
export async function precomputeFeaturesAllSymbols(
  config: PocConfig,
  opts: { source: FeatureSource; years?: string[]; force?: boolean },
): Promise<void> {
  const symbols = listSymbols(config).filter((s) => tableGlob(config, s, opts.source));

  console.log(`${symbols.length} symbols with ${opts.source} data`);

  let done = 0;

  for (const symbol of symbols) {
    done++;
    console.log(`\n[${done}/${symbols.length}] ${symbol}`);

    try {
      await precomputeFeatures(config, symbol, opts);
    } catch (error) {
      /** One bad symbol must not end a run of hundreds. */
      console.log(`${symbol}: FAILED — ${(error as Error).message}`);
    }
  }

  console.log(`\nall symbols done (${symbols.length})`);
}

export async function precomputeFeatures(
  config: PocConfig,
  symbol: string,
  opts: { source: FeatureSource; years?: string[]; force?: boolean },
): Promise<void> {
  const feats = FEATURES.filter((f) => f.source === opts.source);

  if (feats.length === 0) {
    console.log(`no ${opts.source} features`);

    return;
  }

  const srcDir = join(symbolDir(config, symbol), 'parquet', opts.source);

  if (! existsSync(srcDir)) {
    throw new Error(`${opts.source} parquet not found for ${symbol} — import it first`);
  }

  const outDir = join(symbolDir(config, symbol), 'indicators');
  const partDir = join(symbolDir(config, symbol), 'features', opts.source);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(partDir, { recursive: true });

  const table = `feat-${symbol}-${opts.source}`;
  const manifest = readManifest(config);
  const years = (opts.years?.length ? opts.years : sourceYears(srcDir)).sort();
  const { conn, close } = await openDataset(config);

  await conn.run(`SET TimeZone='UTC'`);

  const cols = feats.map((f) => `${f.agg} AS ${f.id}`).join(',\n           ');

  for (const year of years) {
    const key = `${table}/${year}`;
    const part = join(partDir, `${year}.parquet`);

    if (manifest[key] && ! opts.force && existsSync(part)) {
      console.log(`${key}: done (${manifest[key].rows} rows), skip`);
      continue;
    }

    const started = Date.now();
    const src = join(srcDir, `${year}.parquet`);

    console.log(`${key}: aggregating ${feats.length} features…`);

    /** Written to a sibling then renamed, so an interrupt never leaves a half part. */
    const tmp = `${part}.tmp`;

    rmSync(tmp, { force: true });
    await conn.run(
      /**
       * `t` is a TIMESTAMP, never a formatted string — text timestamps cannot be
       * pruned by Parquet statistics and turn every range filter into a scan.
       *
       * No `WHERE symbol`: PARTITION_BY stores the partition key in the directory
       * name, so the per-symbol file has no symbol column and needs no filter.
       */
      `COPY (
         -- End-label like BitMEX bins: a trade at 11:05:30 belongs to the
         -- bin STAMPED 11:06 (covering [11:05, 11:06)).
         SELECT date_trunc('minute', timestamp) + INTERVAL 1 minute AS t,
           ${cols}
         FROM read_parquet('${src}')
         GROUP BY 1 ORDER BY 1
       ) TO '${tmp}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`,
    );

    renameSync(tmp, part);

    const rows = await countRows(conn, part);
    const seconds = Math.round((Date.now() - started) / 1000);

    console.log(`${key}: ${rows} rows, ${seconds}s`);
    bankChunk(config, { table, year, symbols: 1, rows, seconds });
  }

  /** Combine whatever parts exist into the per-feature caches. */
  const parts = readdirSync(partDir).filter((f) => f.endsWith('.parquet'));

  if (parts.length === 0) {
    close();
    console.log('no parts to combine');

    return;
  }

  const glob = join(partDir, '*.parquet');

  for (const f of feats) {
    const out = join(outDir, `${f.id}.parquet`);
    const tmp = `${out}.tmp`;

    await conn.run(
      `COPY (SELECT t, ${f.id} AS v FROM read_parquet('${glob}') ORDER BY t)
       TO '${tmp}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`,
    );

    renameSync(tmp, out);
    console.log(`${f.id} -> cached (${parts.length} years)`);
  }

  close();
  console.log('done');
}

/** Years the source table covers, from its year files. */
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
