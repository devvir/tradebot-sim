import { describe, expect, it } from 'vitest';

import { changePoints } from '../src/series';

import type { ApiPoint } from '@poc/core';

const pts = (...vs: (number | null)[]): ApiPoint[] =>
  vs.map((v, i) => ({ t: `2019-06-09T03:${String(i).padStart(2, '0')}:00.000Z`, v }));

describe('changePoints', () => {
  it('leaves a series that changes every point untouched', () => {
    const p = pts(1, 2, 3, 4);

    expect(changePoints(p)).toEqual(p);
  });

  /** A 5m indicator aligned to 1m repeats each value five times. */
  it('collapses flat runs to the instant the value changed', () => {
    const p = pts(10, 10, 10, 10, 10, 20, 20, 20, 20, 20);
    const out = changePoints(p);

    expect(out.map((x) => x.v)).toEqual([10, 20, 20]);
    /** The 20 is anchored where it first appeared, not where the run ends. */
    expect(out[1].t).toBe('2019-06-09T03:05:00.000Z');
  });

  it('always keeps the last point so the line reaches the right edge', () => {
    const out = changePoints(pts(5, 5, 5, 5));

    expect(out).toHaveLength(2);
    expect(out[out.length - 1].t).toBe('2019-06-09T03:03:00.000Z');
  });

  it('keeps nulls, so gaps still break the line', () => {
    const out = changePoints(pts(1, 1, null, null, 2, 2));

    expect(out.map((x) => x.v)).toEqual([1, null, 2, 2]);
  });

  it('passes through series too short to simplify', () => {
    expect(changePoints(pts(7, 7))).toHaveLength(2);
    expect(changePoints([])).toEqual([]);
  });
});
