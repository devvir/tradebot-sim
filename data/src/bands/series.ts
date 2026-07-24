import { createHash } from 'crypto';
import { createWriteStream, writeFileSync } from 'fs';
import { join } from 'path';

import { BandGateTracker, computeBands, symbolDir } from '@poc/core';

import type { BandParams, BandPoint, Bin1m, PocConfig } from '@poc/core';

/**
 * Precompute the band series for a period: bands are a pure function of the
 * frozen historical bins and the band parameters, so for a fixed parameter
 * set the series is itself frozen — compute once, reuse in visualizations
 * and sims until the parameters change (POC.md). A parameter fingerprint is
 * written alongside so a stale cache can never silently mismatch.
 */
export async function writeBandSeries(
  config: PocConfig,
  symbol: string,
  from: string,
  to: string,
  bins: AsyncIterable<Bin1m> | Bin1m[],
  params: BandParams,
  binMinutes = 1,
): Promise<string> {
  const hash = createHash('sha1').update(JSON.stringify({ ...params, binMinutes })).digest('hex').slice(0, 8);
  const base = join(symbolDir(config, symbol), `bands.${from}_${to}.${hash}`);
  const out = createWriteStream(`${base}.ndjson`);

  writeFileSync(`${base}.params.json`, JSON.stringify({ ...params, binMinutes }, null, 1));

  const innerSamples = Math.max(2, Math.round(params.innerWindow / binMinutes));
  const outerSamples = Math.max(2, Math.round(params.outerWindow / binMinutes));

  const tracker = new BandGateTracker(params, binMinutes);

  const closes: number[] = [];
  const lows: number[] = [];
  const highs: number[] = [];

  let count = 0;

  for await (const bin of bins) {
    const ready = closes.length >= innerSamples;

    if (ready) {
      const b = tracker.update(computeBands(closes, lows, highs, params), bin.close);
      const point: BandPoint = {
        t: bin.t,
        ib: b.inner.bottom,
        it: b.inner.top,
        ob: b.outer.bottom,
        ot: b.outer.top,
        g: b.gateOpen,
        ...(b.gateFail ? { f: b.gateFail } : {}),
      };

      if (! out.write(JSON.stringify(point) + '\n')) {
        await new Promise((res) => out.once('drain', res));
      }

      count++;
    }

    push(closes, bin.close, innerSamples);
    push(lows, bin.low, outerSamples);
    push(highs, bin.high, outerSamples);
  }

  await new Promise((res) => out.end(res));

  console.log(`${count} band points -> ${base}.ndjson (params ${hash})`);

  return `${base}.ndjson`;
}

function push(arr: number[], value: number, max: number): void {
  arr.push(value);

  if (arr.length > max) {
    arr.shift();
  }
}
