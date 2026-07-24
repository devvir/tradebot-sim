import { createReadStream } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

import { symbolDir } from '@poc/core';
import type { Bin1m, PocConfig } from '@poc/core';

/**
 * Load extracted 1m bins for a symbol, filtered to [from, to). Streams the
 * NDJSON — the full-history file exceeds node's single-string limit.
 */
/** Stream bins without materializing the whole file (full-period consumers). */
export async function* streamBins(
  config: PocConfig,
  symbol: string,
  from: string,
  to: string,
  interval = '1m',
): AsyncGenerator<Bin1m> {
  const path = join(symbolDir(config, symbol), `bins${interval}.ndjson`);
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

  for await (const line of rl) {
    if (! line) {
      continue;
    }

    const t = line.slice(6, 30);

    if (t >= from && t < to) {
      yield JSON.parse(line) as Bin1m;
    }
  }
}

export async function loadBins(config: PocConfig, symbol: string, from: string, to: string, interval = '1m'): Promise<Bin1m[]> {
  const path = join(symbolDir(config, symbol), `bins${interval}.ndjson`);
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const bins: Bin1m[] = [];

  for await (const line of rl) {
    if (! line) {
      continue;
    }

    /** Cheap prefilter on the timestamp field before parsing. */
    const t = line.slice(6, 30);

    if (t >= from && t < to) {
      bins.push(JSON.parse(line) as Bin1m);
    }
  }

  return bins;
}
