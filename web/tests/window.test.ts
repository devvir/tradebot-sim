import { describe, expect, it } from 'vitest';

import { covers, nearEdge, padded, slice } from '../src/window';

import type { Windowed } from '../src/types';

const KEY = 'XBTUSD|1m|candles';

/** A window covering [0, 100] with a row every 10. */
function win(from = 0, to = 100, key = KEY): Windowed<{ v: number }> {
  const stamps: number[] = [];

  for (let t = from; t <= to; t += 10) {
    stamps.push(t);
  }

  return { key, from, to, rows: stamps.map((v) => ({ v })), stamps };
}

describe('padded', () => {
  it('adds one span of context either side', () => {
    expect(padded(100, 200)).toEqual({ from: 0, to: 300 });
  });
});

describe('covers', () => {
  it('accepts a range inside the loaded window', () => {
    expect(covers(win(), KEY, 20, 80)).toBe(true);
  });

  it('accepts the exact bounds', () => {
    expect(covers(win(), KEY, 0, 100)).toBe(true);
  });

  it('rejects a range extending past either edge', () => {
    expect(covers(win(), KEY, -1, 50)).toBe(false);
    expect(covers(win(), KEY, 50, 101)).toBe(false);
  });

  it('rejects a window loaded for a different symbol, bin or series', () => {
    expect(covers(win(), 'XBTUSD|5m|candles', 20, 80)).toBe(false);
  });

  it('rejects when nothing is loaded', () => {
    expect(covers(null, KEY, 20, 80)).toBe(false);
  });
});

describe('nearEdge', () => {
  it('is false well inside the buffer', () => {
    expect(nearEdge(win(0, 1000), KEY, 400, 600)).toBe(false);
  });

  it('is true when the viewport approaches an edge', () => {
    /** span 200 → margin 50; left gap of 10 is inside it. */
    expect(nearEdge(win(0, 1000), KEY, 10, 210)).toBe(true);
    expect(nearEdge(win(0, 1000), KEY, 790, 990)).toBe(true);
  });

  it('is false when the window does not cover the range at all', () => {
    /** Not a prefetch case — that is a plain fetch. */
    expect(nearEdge(win(0, 100), KEY, 200, 300)).toBe(false);
  });
});

describe('slice', () => {
  it('returns only rows inside the range, inclusive', () => {
    expect(slice(win(), 20, 40).map((r) => r.v)).toEqual([20, 30, 40]);
  });

  it('returns everything for the full window', () => {
    expect(slice(win(), 0, 100)).toHaveLength(11);
  });

  it('returns nothing for a range with no rows', () => {
    expect(slice(win(), 41, 49)).toEqual([]);
  });

  /** Zooming in is always a subset of what is loaded — the whole point. */
  it('serves a narrowing sequence without ever needing a refetch', () => {
    const w = win(0, 1000);

    for (const [from, to] of [[100, 900], [300, 700], [450, 550]] as const) {
      expect(covers(w, KEY, from, to)).toBe(true);
      expect(slice(w, from, to).length).toBeGreaterThan(0);
    }
  });
});
