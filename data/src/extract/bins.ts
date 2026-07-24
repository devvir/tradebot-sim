import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';

import { MongoClient } from 'mongodb';

import { symbolDir } from '@poc/core';
import type { Bin1m, ExtractBinsOptions, PocConfig } from '@poc/core';

/**
 * Pull tradeBin1m for one symbol from MongoDB into a plain NDJSON file:
 * <pocDir>/<symbol>/bins1m.ndjson. One bounded, indexed pass — the DB is
 * never touched again for this data.
 */
export async function extractBins(config: PocConfig, opts: ExtractBinsOptions): Promise<string> {
  const client = new MongoClient(config.dbUri);

  await client.connect();

  const dir = symbolDir(config, opts.symbol);

  mkdirSync(dir, { recursive: true });

  const outPath = join(dir, `bins${opts.interval ?? '1m'}.ndjson`);
  const out = createWriteStream(outPath);

  const filter: Record<string, unknown> = { symbol: opts.symbol };

  if (opts.from || opts.to) {
    filter.timestamp = {
      ...(opts.from ? { $gte: opts.from } : {}),
      ...(opts.to ? { $lt: opts.to } : {}),
    };
  }

  let count = 0;

  try {
    const cursor = client
      .db()
      .collection(`tradeBin${opts.interval ?? '1m'}`)
      .find(filter)
      .sort({ timestamp: 1 })
      .project({ _id: 0, timestamp: 1, open: 1, high: 1, low: 1, close: 1, trades: 1, volume: 1, vwap: 1 });

    for await (const doc of cursor) {
      const bin: Bin1m = {
        t: doc.timestamp,
        open: doc.open,
        high: doc.high,
        low: doc.low,
        close: doc.close,
        trades: doc.trades,
        volume: doc.volume,
        vwap: doc.vwap,
      };

      if (! out.write(JSON.stringify(bin) + '\n')) {
        await new Promise((res) => out.once('drain', res));
      }

      count++;
    }
  } finally {
    await client.close();
  }

  await new Promise((res) => out.end(res));

  console.log(`${opts.symbol}: ${count} bins -> ${outPath}`);

  return outPath;
}
