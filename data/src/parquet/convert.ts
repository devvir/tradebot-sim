import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

import { DuckDBInstance } from '@duckdb/node-api';

import { symbolDir } from '@poc/core';
import type { PocConfig } from '@poc/core';

/**
 * Convert the extracted flat files (per-year quote/trade CSVs, bins NDJSON)
 * into zstd Parquet under <symbol>/parquet/ — the columnar tier that keeps
 * experiments fast as data grows (POC.md): time-range queries prune to the
 * row groups in range instead of scanning whole files. Ordered by timestamp
 * so row-group min/max stats stay monotonic. CSVs/NDJSON remain the raw
 * tier; conversion is re-runnable (overwrites per-file outputs).
 */
export async function toParquet(config: PocConfig, symbol: string, tables: string[]): Promise<void> {
  const dir = symbolDir(config, symbol);
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();

  /**
   * Hard resource caps — this machine runs other heavy tasks. Spill to disk
   * rather than OOM (an uncapped ORDER BY over 20 GB CSVs crashed the box).
   */
  const spillDir = join(symbolDir(config, symbol), '.duckdb-tmp');

  mkdirSync(spillDir, { recursive: true });
  await conn.run(`SET threads=2`);
  await conn.run(`SET memory_limit='2GB'`);
  await conn.run(`SET temp_directory='${spillDir}'`);
  await conn.run(`SET preserve_insertion_order=false`);

  for (const table of tables) {
    if (table === 'bins') {
      for (const interval of ['1m', '5m']) {
        const src = join(dir, `bins${interval}.ndjson`);

        if (! existsSync(src)) {
          continue;
        }

        const outDir = join(dir, 'parquet');

        mkdirSync(outDir, { recursive: true });

        const out = join(outDir, `bins${interval}.parquet`);

        console.log(`bins${interval} -> ${out}`);
        /** Source already timestamp-sorted → no ORDER BY (streams, low memory, keeps row-group pruning). */
        await conn.run(
          `COPY (SELECT * FROM read_json_auto('${src}'))
           TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`,
        );
      }

      continue;
    }

    /** Per-year CSVs: <table>.<from>_<to>.csv → parquet/<table>/<year>.parquet */
    const files = readdirSync(dir).filter((f) => f.startsWith(`${table}.`) && f.endsWith('.csv'));
    const outDir = join(dir, 'parquet', table);

    mkdirSync(outDir, { recursive: true });

    for (const file of files.sort()) {
      const year = file.slice(table.length + 1, table.length + 5);
      const src = join(dir, file);
      const out = join(outDir, `${year}.parquet`);

      if (existsSync(out)) {
        console.log(`${file} -> exists, skip`);
        continue;
      }

      console.log(`${file} -> ${out}`);
      /**
       * Vault CSVs are already timestamp-sorted (daily buckets in date order)
       * → no ORDER BY. Trade uses an explicit 11-column schema with
       * null_padding: BitMEX added the `trdType` column partway through 2022,
       * so early rows have 10 fields and later rows 11 — the fixed schema
       * normalizes every year to one shape (NULL trdType where absent).
       */
      const readExpr =
        table === 'trade'
          ? `read_csv('${src}', auto_detect = false, delim = ',', quote = '', escape = '',
               header = true, null_padding = true, columns = {
               'timestamp': 'VARCHAR', 'symbol': 'VARCHAR', 'side': 'VARCHAR',
               'size': 'BIGINT', 'price': 'DOUBLE', 'tickDirection': 'VARCHAR',
               'trdMatchID': 'VARCHAR', 'grossValue': 'BIGINT', 'homeNotional': 'DOUBLE',
               'foreignNotional': 'DOUBLE', 'trdType': 'VARCHAR' })`
          : `read_csv('${src}', header = true)`;

      await conn.run(
        `COPY (SELECT * FROM ${readExpr})
         TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`,
      );
    }
  }

  conn.closeSync();
  console.log('done');
}
