import { createWriteStream } from 'fs';
import { join } from 'path';

import { loadBins } from '../data';

import { symbolDir } from '@poc/core';
import type { Bin1m, PocConfig, RangeCandidate, RangeParams, RangesOptions } from '@poc/core';

/**
 * Naive range extractor over 1m bins (v1).
 *
 * A candidate range is born when the trailing `window` minutes fit inside a
 * band of relative amplitude <= `amplitude`. The band is fixed at formation
 * (naive horizontal scaffold); the range survives while closes stay inside,
 * tolerating excursions shorter than `exitConfirm` minutes, and dies when a
 * close-side excursion outlasts it. Candidates shorter than `minDuration`
 * are dropped. Touches count minutes whose high/low enters the outer
 * `touchZone` fraction of the band.
 */
export async function extractRanges(config: PocConfig, opts: RangesOptions): Promise<RangeCandidate[]> {
  const bins = await loadBins(config, opts.symbol, opts.from, opts.to);
  const found: RangeCandidate[] = [];
  const p = opts.params;

  let i = p.window;

  while (i < bins.length) {
    const formation = bins.slice(i - p.window, i);
    const top = Math.max(...formation.map((b) => b.high));
    const bottom = Math.min(...formation.map((b) => b.low));
    const mid = (top + bottom) / 2;

    if ((top - bottom) / mid > p.amplitude) {
      i++;
      continue;
    }

    /** Band formed — walk forward until the exit is confirmed. */
    const startIdx = i - p.window;

    let outSince = -1;
    let exitDirection: RangeCandidate['exitDirection'] = 'eof';
    let j = i;

    for (; j < bins.length; j++) {
      const c = bins[j].close;
      const inside = c <= top && c >= bottom;

      if (inside) {
        outSince = -1;
        continue;
      }

      if (outSince < 0) {
        outSince = j;
      }

      if (j - outSince + 1 >= p.exitConfirm) {
        exitDirection = c > top ? 'up' : 'down';
        break;
      }
    }

    const endIdx = outSince >= 0 && exitDirection !== 'eof' ? outSince : j;
    const durationMin = endIdx - startIdx;

    if (durationMin >= p.minDuration) {
      found.push(buildCandidate(opts.symbol, bins, startIdx, endIdx, top, bottom, p, exitDirection));
    }

    /** Resume scanning after this range (or after the failed formation). */
    i = Math.max(endIdx + 1, i + 1) + (durationMin >= p.minDuration ? p.window : 0);
  }

  return found;
}

export function writeRanges(config: PocConfig, opts: RangesOptions, ranges: RangeCandidate[]): string {
  const outPath = join(symbolDir(config, opts.symbol), `ranges.${opts.from}_${opts.to}.ndjson`);
  const out = createWriteStream(outPath);

  for (const r of ranges) {
    out.write(JSON.stringify(r) + '\n');
  }

  out.end();

  return outPath;
}

export function summarize(ranges: RangeCandidate[]): string {
  if (ranges.length === 0) {
    return 'no ranges found';
  }

  const durations = ranges.map((r) => r.durationMin).sort((a, b) => a - b);
  const amps = ranges.map((r) => r.amplitude).sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const up = ranges.filter((r) => r.exitDirection === 'up').length;
  const down = ranges.filter((r) => r.exitDirection === 'down').length;
  const totalMin = durations.reduce((a, b) => a + b, 0);

  return [
    `ranges: ${ranges.length}  (exit up: ${up}, down: ${down}, eof: ${ranges.length - up - down})`,
    `duration min: p25=${q(durations, 0.25)}m  p50=${q(durations, 0.5)}m  p75=${q(durations, 0.75)}m  max=${durations[durations.length - 1]}m`,
    `amplitude:    p25=${(q(amps, 0.25) * 100).toFixed(2)}%  p50=${(q(amps, 0.5) * 100).toFixed(2)}%  p75=${(q(amps, 0.75) * 100).toFixed(2)}%`,
    `time in ranges: ${(totalMin / 60).toFixed(0)}h total`,
  ].join('\n');
}

function buildCandidate(
  symbol: string,
  bins: Bin1m[],
  startIdx: number,
  endIdx: number,
  top: number,
  bottom: number,
  p: RangeParams,
  exitDirection: RangeCandidate['exitDirection'],
): RangeCandidate {
  const width = top - bottom;
  const touchTop = top - width * p.touchZone;
  const touchBottom = bottom + width * p.touchZone;

  let touchesTop = 0;
  let touchesBottom = 0;

  for (let k = startIdx; k < endIdx; k++) {
    if (bins[k].high >= touchTop) {
      touchesTop++;
    }

    if (bins[k].low <= touchBottom) {
      touchesBottom++;
    }
  }

  return {
    symbol,
    start: bins[startIdx].t,
    end: bins[Math.min(endIdx, bins.length - 1)].t,
    top,
    bottom,
    amplitude: width / ((top + bottom) / 2),
    durationMin: endIdx - startIdx,
    touchesTop,
    touchesBottom,
    exitDirection,
  };
}
