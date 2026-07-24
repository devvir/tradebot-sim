import { createWriteStream, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import { MongoClient } from 'mongodb';

import { bankChunk, openDataset, readManifest } from './dataset';
import { partitionBySymbol } from './partition';

import type { ImportBinsOptions, ImportYearResult, PocConfig } from '@poc/core';

/** Bin collections span up to ~852 symbols; must exceed that or partitions splinter. */
const MAX_OPEN_FILES = 1200;

/**
 * Import Mongo bin collections into the per-symbol Parquet dataset.
 *
 * Bins are the only dataset table sourced from Mongo rather than the raw
 * gzips, but they land in the identical shape as quote/trade —
 * <pocDir>/<symbol>/parquet/<collection>/<year>.parquet — so readers glob one
 * convention and a monthly top-up rewrites a single year file.
 *
 * Each (collection, year) chunk streams out of Mongo through an NDJSON spool,
 * then fans out by symbol. Chunks are banked in the manifest as they land.
 */
export async function importBins(config: PocConfig, opts: ImportBinsOptions): Promise<ImportYearResult[]> {
  const manifest = readManifest(config);
  const results: ImportYearResult[] = [];
  const client = new MongoClient(config.dbUri);

  await client.connect();

  const { conn, close } = await openDataset(config);
  const spoolDir = join(config.pocDir, '.spool');

  mkdirSync(spoolDir, { recursive: true });

  try {
    for (const collection of opts.collections) {
      const years = opts.years.length > 0 ? opts.years : await coveredYears(client, collection);

      for (const year of years) {
        const key = `${collection}/${year}`;

        if (manifest[key] && ! opts.force) {
          console.log(`${key}: done (${manifest[key].rows} rows, ${manifest[key].symbols} symbols), skip`);
          continue;
        }

        const started = Date.now();
        const spool = join(spoolDir, `${collection}-${year}.ndjson`);
        const docs = await spoolYear(client, collection, year, spool, opts.until);

        if (docs === 0) {
          console.log(`${key}: no documents, skip`);
          rmSync(spool, { force: true });
          continue;
        }

        console.log(`${key}: ${docs} docs spooled → partitioning…`);

        const { symbols, rows } = await partitionBySymbol(
          conn,
          config,
          collection,
          year,
          `SELECT * FROM read_json('${spool}', format = 'newline_delimited')`,
          MAX_OPEN_FILES,
        );

        rmSync(spool, { force: true });

        const seconds = Math.round((Date.now() - started) / 1000);

        console.log(`${key}: ${symbols} symbols, ${rows} rows, ${seconds}s`);

        manifest[key] = { table: collection, year, symbols, rows, seconds };
        bankChunk(config, manifest[key]);
        results.push(manifest[key]);
      }
    }
  } finally {
    close();
    await client.close();
  }

  console.log('done');

  return results;
}

/** Years the collection actually spans, from its first and last document. */
async function coveredYears(client: MongoClient, collection: string): Promise<string[]> {
  const col = client.db().collection(collection);
  const first = await col.find({}).sort({ timestamp: 1 }).limit(1).next();
  const last = await col.find({}).sort({ timestamp: -1 }).limit(1).next();

  if (! first || ! last) {
    return [];
  }

  const from = Number(String(first.timestamp).slice(0, 4));
  const to = Number(String(last.timestamp).slice(0, 4));
  const years: string[] = [];

  for (let y = from; y <= to; y++) {
    years.push(String(y));
  }

  return years;
}

/**
 * Stream one year of a bin collection to NDJSON via the {symbol, timestamp}
 * index. Timestamps are stored as ISO strings, so the range bounds compare
 * lexicographically.
 */
async function spoolYear(
  client: MongoClient,
  collection: string,
  year: string,
  spool: string,
  until?: string,
): Promise<number> {
  const start = `${year}-01-01T00:00:00.000Z`;
  const endOfYear = `${Number(year) + 1}-01-01T00:00:00.000Z`;
  const cutoff = until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T23:59:59.999Z` : undefined;
  const end = cutoff && cutoff < endOfYear ? cutoff : endOfYear;

  const out = createWriteStream(spool);
  const cursor = client
    .db()
    .collection(collection)
    .find({ timestamp: { $gte: start, $lt: end } })
    .project({ _id: 0 });

  let docs = 0;

  for await (const doc of cursor) {
    if (! out.write(JSON.stringify(doc) + '\n')) {
      await new Promise((resolve) => out.once('drain', resolve));
    }

    docs++;
  }

  await new Promise((resolve) => out.end(resolve));

  return docs;
}
