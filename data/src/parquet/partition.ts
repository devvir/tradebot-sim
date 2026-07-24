import { mkdirSync, readdirSync, renameSync, rmSync } from 'fs';
import { join } from 'path';

import type { DuckDBConnection } from '@duckdb/node-api';

import { symbolDir } from '@poc/core';
import type { PartitionResult, PocConfig } from '@poc/core';

/** Bounds peak RSS of the partitioned write — measured ~1.5 GB anon at 164 open partitions. */
const ROW_GROUP_SIZE = 100_000;

/**
 * Fan one year of an all-symbol source out into the per-symbol dataset.
 *
 * Runs `selectSql` through a PARTITION_BY (symbol) write into staging, then
 * files each partition as <pocDir>/<symbol>/parquet/<table>/<year>.parquet.
 * Every table in the dataset — quote, trade, tradeBin1m, … — lands in that
 * same shape, so readers glob one convention and monthly top-ups rewrite a
 * single year rather than the whole history.
 *
 * One year at a time is deliberate: partitioning by (symbol, year) at once
 * would open symbols × years files and force the writer to flush and reopen,
 * splintering each partition across many fragments.
 */
export async function partitionBySymbol(
  conn: DuckDBConnection,
  config: PocConfig,
  table: string,
  year: string,
  selectSql: string,
  maxOpenFiles: number,
): Promise<PartitionResult> {
  const staging = join(config.pocDir, `.staging-${table}-${year}`);

  rmSync(staging, { recursive: true, force: true });

  await conn.run(`SET partitioned_write_max_open_files=${maxOpenFiles}`);

  /**
   * Row order must survive the write when the select assigns a sequence number
   * (trade), or `seq` would be meaningless. Costs some write parallelism.
   */
  const ordered = selectSql.includes('AS seq');

  await conn.run(`SET preserve_insertion_order=${ordered}`);
  await conn.run(
    `COPY (${selectSql})
     TO '${staging}'
     (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (symbol),
      ROW_GROUP_SIZE ${ROW_GROUP_SIZE}, OVERWRITE_OR_IGNORE)`,
  );

  const partitions = readdirSync(staging).filter((d) => d.startsWith('symbol='));
  const written: string[] = [];

  for (const partition of partitions) {
    const symbol = decodeURIComponent(partition.slice('symbol='.length));
    const outDir = join(symbolDir(config, symbol), 'parquet', table);

    mkdirSync(outDir, { recursive: true });

    const parts = readdirSync(join(staging, partition))
      .filter((f) => f.endsWith('.parquet'))
      .sort();

    /** Normally one file per partition; suffix only if the writer had to split it. */
    parts.forEach((part, i) => {
      const out = join(outDir, parts.length === 1 ? `${year}.parquet` : `${year}_${i}.parquet`);

      renameSync(join(staging, partition, part), out);
      written.push(out);
    });
  }

  rmSync(staging, { recursive: true, force: true });

  return { symbols: partitions.length, rows: await countRows(conn, written) };
}

/** Row count straight from the Parquet footers — no data scan. */
async function countRows(conn: DuckDBConnection, paths: string[]): Promise<number> {
  if (paths.length === 0) {
    return 0;
  }

  const list = paths.map((p) => `'${p}'`).join(', ');
  const reader = await conn.runAndReadAll(`SELECT count(*) AS n FROM read_parquet([${list}])`);

  return Number(reader.getRows()[0][0]);
}
