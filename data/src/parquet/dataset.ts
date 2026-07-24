import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { DuckDBInstance } from '@duckdb/node-api';

import type { DuckDBConnection } from '@duckdb/node-api';
import type { ImportYearResult, PocConfig } from '@poc/core';

/**
 * Shared plumbing for every importer that writes the per-symbol dataset: a
 * resource-capped DuckDB connection, and the manifest recording which
 * (table, year) chunks have landed so runs are restartable and additive.
 */

/** Hard caps — this machine runs other heavy jobs. Spill to disk rather than OOM. */
export async function openDataset(config: PocConfig): Promise<{ conn: DuckDBConnection; close: () => void }> {
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();
  const spillDir = join(config.pocDir, '.duckdb-tmp');

  mkdirSync(spillDir, { recursive: true });
  await conn.run(`SET threads=4`);
  await conn.run(`SET memory_limit='3GB'`);
  await conn.run(`SET temp_directory='${spillDir}'`);
  await conn.run(`SET preserve_insertion_order=false`);

  return { conn, close: () => conn.closeSync() };
}

/**
 * The manifest is a DIRECTORY of one small file per chunk, never a single
 * document. Importers run concurrently (raw and bins at once), and a shared
 * read-modify-write file loses updates: whichever process read first wins the
 * write, silently discarding chunks the other had banked. One file per chunk
 * removes the shared mutable state entirely.
 */
export function readManifest(config: PocConfig): Record<string, ImportYearResult> {
  const dir = manifestDir(config);

  if (! existsSync(dir)) {
    return {};
  }

  const manifest: Record<string, ImportYearResult> = {};

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const entry: ImportYearResult = JSON.parse(readFileSync(join(dir, file), 'utf8'));

    manifest[`${entry.table}/${entry.year}`] = entry;
  }

  return manifest;
}

/** Bank one completed chunk. Independent file per chunk — no cross-process contention. */
export function bankChunk(config: PocConfig, entry: ImportYearResult): void {
  const dir = manifestDir(config);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${entry.table}-${entry.year}.json`), JSON.stringify(entry, null, 2));
}

/** Latest year already banked for a table, or undefined — the additive-run starting point. */
export function lastImportedYear(manifest: Record<string, ImportYearResult>, table: string): string | undefined {
  const years = Object.values(manifest)
    .filter((entry) => entry.table === table)
    .map((entry) => entry.year)
    .sort();

  return years[years.length - 1];
}

function manifestDir(config: PocConfig): string {
  return join(config.pocDir, 'manifest');
}
