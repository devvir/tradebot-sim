import { describe, expect, it } from 'vitest';

import { Account } from '../src/sim/account';

import type { AccountParams } from '../src/types';

const NO_FEES: AccountParams = { takerFee: 0, initMargin: 0.01 };
const FEES: AccountParams = { takerFee: 0.0005, initMargin: 0.01 };

describe('Account (XBTUSD inverse arithmetic)', () => {
  it('realizes long PnL as size × (1/entry − 1/exit)', () => {
    const acc = new Account(NO_FEES, 1);

    acc.open('long', 10000, 50000);

    const pnl = acc.reduce('long', 10000, 55000);

    expect(pnl).toBeCloseTo(10000 * (1 / 50000 - 1 / 55000), 12);
    expect(acc.snapshot(55000).wallet).toBeCloseTo(1 + pnl, 12);
  });

  it('realizes short PnL with the mirrored sign', () => {
    const acc = new Account(NO_FEES, 1);

    acc.open('short', 10000, 50000);

    const pnl = acc.reduce('short', 10000, 45000);

    expect(pnl).toBeCloseTo(-10000 * (1 / 50000 - 1 / 45000), 12);
    expect(pnl).toBeGreaterThan(0);
  });

  it('blends the average entry harmonically on adds', () => {
    const acc = new Account(NO_FEES, 1);

    acc.open('long', 10000, 50000);
    acc.open('long', 10000, 40000);

    /** 20000 / (10000/50000 + 10000/40000) = 20000 / 0.45 */
    const expected = 20000 / (10000 / 50000 + 10000 / 40000);
    const snap = acc.snapshot(45000);

    expect(snap.long.avgEntry).toBeCloseTo(expected, 9);

    /** Closing everything at the blended entry realizes ~zero. */
    expect(acc.reduce('long', 20000, expected)).toBeCloseTo(0, 12);
  });

  it('balanced pair uPnL is price-independent: S × (1/eLong − 1/eShort)', () => {
    const acc = new Account(NO_FEES, 1);

    acc.open('long', 10000, 50000);
    acc.open('short', 10000, 48000);

    const expected = 10000 * (1 / 50000 - 1 / 48000);

    for (const price of [30000, 48000, 50000, 70000, 120000]) {
      expect(acc.snapshot(price).uPnl).toBeCloseTo(expected, 12);
    }

    expect(expected).toBeLessThan(0);
  });

  it('charges taker fees on every fill and tracks them separately from PnL', () => {
    const acc = new Account(FEES, 1);

    acc.open('long', 10000, 50000);

    const openFee = 0.0005 * (10000 / 50000);

    expect(acc.snapshot(50000).feesPaid).toBeCloseTo(openFee, 12);

    acc.reduce('long', 10000, 50000);

    const closeFee = openFee;
    const snap = acc.snapshot(50000);

    expect(snap.feesPaid).toBeCloseTo(openFee + closeFee, 12);
    expect(snap.realized).toBeCloseTo(0, 12);
    expect(snap.wallet).toBeCloseTo(1 - openFee - closeFee, 12);
  });

  it('computes gross position margin and available margin', () => {
    const acc = new Account(NO_FEES, 1);

    acc.open('long', 10000, 50000);
    acc.open('short', 10000, 50000);

    const snap = acc.snapshot(50000);

    /** Gross: both legs consume margin — (10000+10000)/50000 × 1%. */
    expect(snap.positionMargin).toBeCloseTo((20000 / 50000) * 0.01, 12);
    expect(snap.availableMargin).toBeCloseTo(1 + snap.uPnl - snap.positionMargin, 12);
    expect(snap.equity).toBeCloseTo(1 + snap.uPnl, 12);
  });

  it('rejects reducing more than the leg size', () => {
    const acc = new Account(NO_FEES, 1);

    acc.open('long', 100, 50000);

    expect(() => acc.reduce('long', 200, 50000)).toThrow();
  });

  it('wallet-neutral paired realize nets the harvested oscillation', () => {
    /**
     * The recovery identity (STRATEGY.md §Freeze exit): reduce the losing
     * long x at P and the winning short x at P′ < P; realized flows plus the
     * remaining pair's (unchanged-per-unit) uPnL net to +x(1/P′ − 1/P)-ish
     * in inverse terms — here asserted via equity delta at constant price.
     */
    const acc = new Account(NO_FEES, 1);

    acc.open('long', 10000, 52000);
    acc.open('short', 10000, 50000);

    const before = acc.snapshot(46000).equity;

    /** Scalp inside the new range: reduce short low, reduce long high. */
    acc.reduce('short', 1000, 45000);
    acc.reduce('long', 1000, 47000);

    const after = acc.snapshot(46000).equity;
    const harvested = 1000 * (1 / 45000 - 1 / 47000);

    expect(after - before).toBeCloseTo(harvested, 12);
    expect(harvested).toBeGreaterThan(0);
  });
});
