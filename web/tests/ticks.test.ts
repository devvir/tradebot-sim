import { describe, expect, it } from 'vitest';

import { niceStep, priceTicks, tickDecimals, timeTicks } from '../src/ticks';

describe('niceStep', () => {
  it('picks 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(1000, 5)).toBe(200);
    expect(niceStep(0.04, 4)).toBe(0.01);
  });

  it('rounds to the nearest nice value, not up', () => {
    /** 37/6 = 6.17 → 5, which gives ~7 gridlines; rounding up to 10 gives 4. */
    expect(niceStep(37, 6)).toBe(5);
  });

  it('survives degenerate input', () => {
    expect(niceStep(0, 5)).toBe(1);
    expect(niceStep(-5, 5)).toBe(1);
  });
});

describe('priceTicks', () => {
  it('lands on round multiples of the step', () => {
    const ticks = priceTicks(7850, 7960, 5);
    const step = niceStep(7960 - 7850, 5);

    expect(ticks.length).toBeGreaterThan(3);
    ticks.forEach((v) => expect(Math.abs(v / step - Math.round(v / step))).toBeLessThan(1e-9));
  });

  it('produces roughly the requested number of ticks', () => {
    for (const [lo, hi] of [[0, 1], [7850, 7960], [1, 100000]] as const) {
      const n = priceTicks(lo, hi, 6).length;

      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(14);
    }
  });

  it('never returns a tick outside the range', () => {
    const ticks = priceTicks(1234, 5678, 6);

    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(1234);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(5678);
  });

  it('handles sub-unit prices without collapsing', () => {
    expect(priceTicks(0.742, 0.751, 4).length).toBeGreaterThan(1);
  });

  it('returns nothing for an empty or invalid range', () => {
    expect(priceTicks(100, 100)).toEqual([]);
    expect(priceTicks(NaN, 10)).toEqual([]);
  });
});

describe('timeTicks', () => {
  const t = (iso: string) => Date.parse(iso);

  it('uses minute boundaries for an intraday window', () => {
    const ticks = timeTicks(t('2019-06-09T03:00:00Z'), t('2019-06-09T04:00:00Z'), 6);

    expect(ticks.length).toBeGreaterThan(2);
    ticks.forEach((x) => expect(x % 60_000).toBe(0));
  });

  it('steps up to days over a multi-week span', () => {
    const ticks = timeTicks(t('2019-06-01T00:00:00Z'), t('2019-07-01T00:00:00Z'), 6);

    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[1] - ticks[0]).toBeGreaterThanOrEqual(86_400_000);
  });

  it('returns nothing for a zero or inverted span', () => {
    expect(timeTicks(100, 100)).toEqual([]);
    expect(timeTicks(200, 100)).toEqual([]);
  });
});

describe('tickDecimals', () => {
  it('drops decimals for large steps and keeps them for small', () => {
    expect(tickDecimals(25)).toBe(0);
    expect(tickDecimals(0.01)).toBe(3);
  });
});
