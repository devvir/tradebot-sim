import { describe, expect, it } from 'vitest';

import { BandGateTracker, computeBands } from '../src/sim/bands';

import type { BandParams } from '../src/types';

const PARAMS: BandParams = {
  innerWindow: 10,
  innerOccupancy: 0.8,
  outerWindow: 5,
  outerOccupancy: 1,
  outerLeniency: 1,
  maxInnerWidth: 0.03,
  outerCap: 0.05,
  mergeLookback: 0,
  mergeWeightNow: 1,
  mergeWeightPast: 1,
  jumpLookback: 3,
  expansionLookback: 4,
  expansionMax: 1.5,
  crossCooldown: 0,
  outerMinRatio: 1,
};

describe('computeBands (naive v2)', () => {
  it('inner band is the symmetric 80% time-occupancy percentile interval', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 200];
    const r = computeBands(closes, [99, 99, 99, 99, 99], [210, 210, 210, 210, 210], PARAMS);

    /** ~p10..p90 of the sorted closes: drops the 200 outlier. */
    expect(r.inner.bottom).toBe(101);
    expect(r.inner.top).toBe(108);
  });

  it('outer band is min low .. max high of its window (occupancy 1)', () => {
    const r = computeBands(
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [98, 99, 97.5, 99, 99],
      [101, 102.5, 101, 101, 102],
      PARAMS,
    );

    expect(r.outer).toEqual({ bottom: 97.5, top: 102.5 });
    expect(r.gateOpen).toBe(true);
  });

  it('outer band is capped at outerCap width, centered on its mid', () => {
    const r = computeBands(
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [90, 100, 100, 100, 100],
      [110, 100, 100, 100, 100],
      PARAMS,
    );

    /** Raw outer 90-110 (20% wide) capped to 5% around mid 100. */
    expect(r.outer.bottom).toBeCloseTo(97.5, 9);
    expect(r.outer.top).toBeCloseTo(102.5, 9);
  });

  it('gate fails on inner width (wider than max = wait)', () => {
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 104, 104];
    const r = computeBands(closes, [95], [110], PARAMS);

    expect(r.gateFail).toBe('inner-width');
  });

  it('gate fails on containment after a relocation', () => {
    /** Six old closes at 100, four recent at 102: inner stretches to the
        old zone (still narrow enough), but the outer window only saw the
        new location — inner pokes below outer. */
    const closes = [100, 100, 100, 100, 100, 100, 102, 102, 102, 102];
    const r = computeBands(closes, [101.5, 101.5, 101.5, 101.5, 101.5], [102.5, 102.5, 102.5, 102.5, 102.5], PARAMS);

    expect(r.gateFail).toBe('containment');
  });
});

describe('BandGateTracker (band dynamics)', () => {
  const open = (ib: number, it: number, ob: number, ot: number) => ({ inner: { bottom: ib, top: it }, outer: { bottom: ob, top: ot }, gateOpen: true });

  it('closes the gate on a level jump (cross-time containment)', () => {
    const tr = new BandGateTracker(PARAMS, 1);

    for (let k = 0; k < 5; k++) {
      expect(tr.update(open(100, 101, 99, 102)).gateFail).toBeUndefined();
    }

    /** Inner relocates below where the outer was 3 samples ago. */
    const r = tr.update(open(95, 96, 94, 102));

    expect(r.gateOpen).toBe(false);
    expect(r.gateFail).toBe('jump');
  });

  it('closes the gate on width expansion vs rolling average', () => {
    const tr = new BandGateTracker({ ...PARAMS, jumpLookback: 100 }, 1);

    for (let k = 0; k < 6; k++) {
      expect(tr.update(open(100, 101, 99.5, 101.5)).gateFail).toBeUndefined();
    }

    /** Outer width doubles vs its ~2% average. */
    const r = tr.update(open(100, 101, 98, 103));

    expect(r.gateOpen).toBe(false);
    expect(r.gateFail).toBe('expansion');
  });
});

describe('BandGateTracker temporal merge', () => {
  const open = (ib: number, it: number, ob: number, ot: number) => ({ inner: { bottom: ib, top: it }, outer: { bottom: ob, top: ot }, gateOpen: true });

  it('working bands are the intersection of now and mergeLookback ago', () => {
    const tr = new BandGateTracker({ ...PARAMS, mergeLookback: 2, jumpLookback: 100 }, 1);

    tr.update(open(100, 101, 99, 102));
    tr.update(open(100, 101, 99, 102));

    /** Drifted slightly up: intersection trails. */
    const r = tr.update(open(100.5, 101.5, 99.5, 102.5));

    expect(r.inner).toEqual({ bottom: 100.5, top: 101 });
    expect(r.outer).toEqual({ bottom: 99.5, top: 102 });
    expect(r.gateOpen).toBe(true);
  });

  it('closes the gate with "disagreement" when the bands are disjoint', () => {
    const tr = new BandGateTracker({ ...PARAMS, mergeLookback: 2, jumpLookback: 100 }, 1);

    tr.update(open(100, 101, 99, 102));
    tr.update(open(100, 101, 99, 102));

    const r = tr.update(open(90, 91, 89, 92));

    expect(r.gateOpen).toBe(false);
    expect(r.gateFail).toBe('disagreement');
  });
});

describe('BandGateTracker cooldown and outer minimum', () => {
  const open = (ib: number, it: number, ob: number, ot: number) => ({ inner: { bottom: ib, top: it }, outer: { bottom: ob, top: ot }, gateOpen: true });

  it('keeps the gate closed for crossCooldown after the close was outside', () => {
    const tr = new BandGateTracker({ ...PARAMS, crossCooldown: 3, jumpLookback: 100 }, 1);

    expect(tr.update(open(100, 101, 99, 102), 100.5).gateOpen).toBe(true);

    /** Close beyond the outer top → cooldown starts. */
    expect(tr.update(open(100, 101, 99, 102), 103).gateFail).toBe('cooldown');
    expect(tr.update(open(100, 101, 99, 102), 100.5).gateFail).toBe('cooldown');
    expect(tr.update(open(100, 101, 99, 102), 100.5).gateFail).toBe('cooldown');
    expect(tr.update(open(100, 101, 99, 102), 100.5).gateOpen).toBe(true);
  });

  it('widens the working outer band to outerMinRatio × inner width', () => {
    const tr = new BandGateTracker({ ...PARAMS, outerMinRatio: 1.5, jumpLookback: 100 }, 1);

    /** Inner 2 wide, raw outer only 2.2 wide → widened to 3 around its mid. */
    const r = tr.update(open(100, 102, 99.9, 102.1), 101);

    expect(r.outer.top - r.outer.bottom).toBeCloseTo(3, 9);
    expect((r.outer.top + r.outer.bottom) / 2).toBeCloseTo(101, 9);
  });
});
