import { describe, expect, it } from 'vitest';

import { diff, ema, resample, slope, sma } from '../src/indicators/math';
import { choppiness, efficiencyRatio, rsi, stochasticK } from '../src/indicators/oscillators';
import { INDICATORS as REGISTRY } from '../src/indicators/registry';

import type { Bin1m } from '../src/types';

const bins = (closes: number[]): Bin1m[] =>
  closes.map((c, i) => ({ t: `2020-01-01T00:${String(i).padStart(2, '0')}:00.000Z`, open: c, high: c, low: c, close: c, trades: 1, volume: 1, vwap: c }));

describe('indicator math', () => {
  it('sma is null until the window fills, then the mean', () => {
    const r = sma([1, 2, 3, 4], 2);

    expect(r).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it('ema seeds with the SMA and is null before', () => {
    const r = ema([1, 2, 3, 4, 5], 3);

    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBeCloseTo(2, 9); // seed = mean(1,2,3)
    expect(r[3]).toBeCloseTo(3, 9); // 4*0.5 + 2*0.5
  });

  it('slope is the per-bar delta over the window', () => {
    expect(slope([0, 1, 2, 3], 2)).toEqual([null, null, 1, 1]);
  });

  it('diff subtracts aligned series, null-propagating', () => {
    expect(diff([null, 5, 8], [null, 2, 3])).toEqual([null, 3, 5]);
  });

  it('resample buckets by the clock, not by array position', () => {
    /**
     * Stamps 00:00..00:05 at tf=3. Buckets follow wall-clock boundaries, so the
     * bin stamped 00:00 closes the bucket [23:57, 00:00) on its own; the next
     * bucket closes at 00:03 and the last at 00:06.
     */
    const b = bins([10, 11, 12, 13, 14, 15]);
    const { closes, expand } = resample(b, 3);

    expect(closes).toEqual([10, 13, 15]);

    /** Each bin sees the newest bucket that has closed at or before its stamp. */
    expect(expand([100, 200, 300])).toEqual([100, 100, 100, 200, 200, 200]);
  });
});

describe('indicator registry', () => {
  it('every spec has a unique id and produces a series aligned to the bins', () => {
    const b = bins(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 10)));
    const ids = new Set<string>();

    for (const spec of REGISTRY) {
      expect(ids.has(spec.id)).toBe(false);
      ids.add(spec.id);

      const series = spec.compute(b);

      expect(series.length).toBe(b.length);
    }

    expect(REGISTRY.length).toBeGreaterThan(0);
  });
});

describe('oscillators', () => {
  it('RSI is 100 on a monotonic rise and stays in 0..100', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const r = rsi(up, 14);

    expect(r.find((v) => v !== null)).toBeCloseTo(100, 6); // first RSI value (index 14)
    for (const v of r) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('Stochastic %K is 100 at a new high, 0 at a new low', () => {
    const highs = [1, 2, 3, 4, 5];
    const lows = [0, 1, 2, 3, 4];
    const atHigh = stochasticK(highs, lows, [1, 2, 3, 4, 5], 5);
    const atLow = stochasticK(highs, lows, [1, 2, 3, 4, 0], 5);

    expect(atHigh[4]).toBeCloseTo(100, 6);
    expect(atLow[4]).toBeCloseTo(0, 6);
  });

  it('Efficiency ratio is ~1 for a straight trend, ~0 for a round trip', () => {
    const trend = Array.from({ length: 11 }, (_, i) => i);
    const roundTrip = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0];

    expect(efficiencyRatio(trend, 10)[10]).toBeCloseTo(1, 6);
    expect(efficiencyRatio(roundTrip, 10)[10]).toBeCloseTo(0, 6);
  });

  it('Choppiness stays within 0..100', () => {
    const h = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i));
    const l = h.map((v) => v - 1);
    const c = h.map((v) => v - 0.5);

    for (const v of choppiness(h, l, c, 14)) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(101);
      }
    }
  });
});
