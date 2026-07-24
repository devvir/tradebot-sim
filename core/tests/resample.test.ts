import { describe, expect, it } from 'vitest';

import { bucketEnds, resample, resampleBins } from '../src/indicators/math';

import type { Bin1m } from '../src/types';

/** Bins at the given HH:MM stamps, close = index so buckets are identifiable. */
const bins = (...stamps: string[]): Bin1m[] =>
  stamps.map((s, i) => ({
    t: `2019-06-09T${s}:00.000Z`,
    open: i,
    high: i + 1,
    low: i - 1,
    close: i,
    trades: 1,
    volume: 10,
    vwap: i,
  }));

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

describe('bucketEnds', () => {
  /** End-labelled: a bin stamped 11:05 CLOSES the 5m bucket stamped 11:05. */
  it('puts a boundary-exact stamp in the bucket it closes', () => {
    expect(bucketEnds(bins('11:05'), 5).map(hhmm)).toEqual(['11:05']);
  });

  it('puts a mid-interval stamp in the bucket that will close after it', () => {
    expect(bucketEnds(bins('11:06', '11:07'), 5).map(hhmm)).toEqual(['11:10', '11:10']);
  });

  /** The whole point: buckets follow the clock, not the array offset. */
  it('is unaffected by where the data starts', () => {
    const a = bucketEnds(bins('11:03', '11:04', '11:05'), 5).map(hhmm);
    const b = bucketEnds(bins('11:04', '11:05'), 5).map(hhmm);

    expect(a).toEqual(['11:05', '11:05', '11:05']);
    expect(b).toEqual(['11:05', '11:05']);
  });
});

describe('resample', () => {
  it('closes a bucket on its final bin, on clock boundaries', () => {
    /** 11:01..11:10 → two 5m buckets, closing at 11:05 and 11:10. */
    const b = bins('11:01', '11:02', '11:03', '11:04', '11:05', '11:06', '11:07', '11:08', '11:09', '11:10');

    expect(resample(b, 5).closes).toEqual([4, 9]);
  });

  it('does not stretch a bucket across a gap', () => {
    /** 11:04 then a jump to 11:37: two separate buckets, not one of two bins. */
    const b = bins('11:04', '11:37');

    expect(resample(b, 5).closes).toHaveLength(2);
  });

  /** A partial leading bucket is still its own bucket — it just holds fewer bins. */
  it('handles data starting mid-bucket', () => {
    const b = bins('11:04', '11:05', '11:06');

    expect(resample(b, 5).closes).toEqual([1, 2]);
  });
});

describe('resampleBins', () => {
  it('aggregates high/low/volume within clock buckets', () => {
    const b = bins('11:04', '11:05', '11:06');
    const r = resampleBins(b, 5);

    /** Bucket 11:05 = bins 0,1; bucket 11:10 = bin 2. */
    expect(r.volume).toEqual([20, 10]);
    expect(r.high).toEqual([2, 3]);
    expect(r.close).toEqual([1, 2]);
  });
});

describe('expand — the lookahead rule', () => {
  it('reveals a bucket only from the bin that closes it', () => {
    const b = bins('11:01', '11:02', '11:03', '11:04', '11:05', '11:06');
    const { expand } = resample(b, 5);

    /** Two buckets (closing 11:05 and 11:10); label them 100 and 200. */
    const out = expand([100, 200]);

    /** Nothing visible until 11:05 closes the first bucket; 11:06 still sees it. */
    expect(out).toEqual([null, null, null, null, 100, 100]);
  });

  it('never shows a bucket to a bin inside it', () => {
    const b = bins('11:06', '11:07', '11:08', '11:09', '11:10');
    const { expand } = resample(b, 5);
    const out = expand([999]);

    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toBe(999);
  });
});
