import { Account } from './account';
import { naiveStrategy } from './strategy';

import type { AccountSnapshot, Bin1m, HourlyRow, Side, SimEvent, SimMode, SimParams, SimResult, Strategy } from '../types';

/**
 * Naive v1 simulator, no recovery: idle → trading → waiting → frozen → STOP
 * (NAIVE.md; recovery is a later iteration). Price feed is 1m bins — close
 * drives decisions and mode transitions; high/low trigger resting orders.
 *
 * Emits an hourly min/max evolution log plus an event log; charting parses
 * these later (POC.md).
 */
export function runSim(bins: Bin1m[], params: SimParams): SimResult {
  const account = new Account(params.account, params.initialWallet);
  const strategy = naiveStrategy(params);
  const events: SimEvent[] = [];
  const rows: HourlyRow[] = [];

  const closes: number[] = [];
  const lows: number[] = [];
  const highs: number[] = [];

  let mode: SimMode = 'idle';
  let frozeAt: string | undefined;
  let bustedAt: string | undefined;
  let gapAtFreeze: number | undefined;
  let frozenUPnl: number | undefined;
  const bustFloor = strategy.bustFloor();
  let hour = '';
  let agg: HourlyRow | undefined;
  let tradesInHour = 0;

  /** Per-side book state (ladder levels armed at episode start). */
  const books: Record<Side, BookState> = { long: freshBook(), short: freshBook() };

  const log = (t: string, type: string, detail: string) => {
    events.push({ t, type, detail });
  };

  let minuteIndex = 0;
  let stormStreak = 0;
  let unsizable = false;

  for (const bin of bins) {
    minuteIndex++;
    /**
     * Bands come from the window ending at the PREVIOUS bin — including the
     * current bin would put its own low/high inside the band, making "price
     * left the band" unreachable by construction.
     */
    const bands = strategy.bands(closes, lows, highs, minuteIndex);

    pushWindow(closes, bin.close, params.bands.innerWindow);
    pushWindow(lows, bin.low, params.bands.outerWindow);
    pushWindow(highs, bin.high, params.bands.outerWindow);

    if (! bands) {
      continue;
    }

    const price = bin.close;

    if (mode !== 'idle' && account.snapshot(price).availableMargin < bustFloor) {
      mode = 'busted';
      bustedAt = bin.t;
      log(bin.t, 'busted', `available margin below ${bustFloor} XBT`);
    }

    if (mode === 'busted') {
      /** Fall through to aggregation; loop breaks below. */
    } else if (mode === 'idle' && bands.gateOpen) {
      const step = strategy.stepContracts(account.snapshot(price).wallet, price);

      if (step >= 100) {
        mode = 'trading';
        startEpisode(account, books, bin, strategy);
        tradesInHour += 2;
        log(bin.t, 'episode-start', `pair opened @ ${price}, inner ${bands.inner.bottom}-${bands.inner.top}`);
      } else if (! unsizable) {
        unsizable = true;
        log(bin.t, 'unsizable', `step ${step} < 100 contracts at price ${price} — wallet too small, staying idle`);
      }
    } else if (mode === 'trading') {
      stormStreak = updateStormStreak(stormStreak, price, bands.outer, params);

      if (stormStreak >= params.exitConfirm) {
        mode = 'frozen';
        frozeAt = bin.t;
        tradesInHour += freeze(account, price);

        const snap = account.snapshot(price);

        gapAtFreeze = entriesGap(snap);
        frozenUPnl = snap.uPnl;
        log(bin.t, 'freeze', `price ${price} left outer ${bands.outer.bottom}-${bands.outer.top}, gap ${(100 * (gapAtFreeze ?? 0)).toFixed(3)}%`);
      } else if (price > bands.inner.top || price < bands.inner.bottom) {
        mode = 'waiting';
        log(bin.t, 'waiting', `price ${price} left inner ${bands.inner.bottom}-${bands.inner.top}`);
      } else {
        tradesInHour += tradeBin(account, books, bin, strategy, log);
      }
    } else if (mode === 'waiting') {
      stormStreak = updateStormStreak(stormStreak, price, bands.outer, params);

      if (stormStreak >= params.exitConfirm) {
        mode = 'frozen';
        frozeAt = bin.t;
        tradesInHour += freeze(account, price);

        const snap = account.snapshot(price);

        gapAtFreeze = entriesGap(snap);
        frozenUPnl = snap.uPnl;
        log(bin.t, 'freeze', `price ${price} left outer ${bands.outer.bottom}-${bands.outer.top}, gap ${(100 * (gapAtFreeze ?? 0)).toFixed(3)}%`);
      } else if (price <= bands.inner.top && price >= bands.inner.bottom) {
        mode = 'trading';
        log(bin.t, 'resume', `price ${price} back inside inner`);
      }
    }

    /** Hourly aggregation. */
    const binHour = bin.t.slice(0, 13);
    const snap = account.snapshot(price);

    if (binHour !== hour) {
      if (agg) {
        rows.push(agg);
      }

      hour = binHour;
      agg = freshRow(binHour, bin, snap, mode);
      tradesInHour = 0;
    } else if (agg) {
      updateRow(agg, bin, snap, mode, tradesInHour);
    }

    if (mode === 'frozen' || mode === 'busted') {
      break;
    }
  }

  if (agg) {
    rows.push(agg);
  }

  const last = bins[bins.length - 1];

  return { rows, events, frozeAt, bustedAt, gapAtFreeze, frozenUPnl, finalSnapshot: account.snapshot(last.close) };
}

/**
 * A storm is price sitting beyond the outer band by exitMargin; the streak
 * counts consecutive such minutes and the caller freezes at exitConfirm.
 */
function updateStormStreak(
  streak: number,
  price: number,
  outer: { top: number; bottom: number },
  params: SimParams,
): number {
  const beyond = price > outer.top * (1 + params.exitMargin) || price < outer.bottom * (1 - params.exitMargin);

  return beyond ? streak + 1 : 0;
}

interface BookState {
  /** Ladder anchor entry price (set at episode start / re-arm). */
  anchor: number;
  /** Resting extend levels not yet filled. */
  addLevels: number[];
  /** Contracts per step (fixed at episode start). */
  step: number;
  /** Step collects already taken since the last extend (resets when the entry moves). */
  collectStep: number;
  /** Price of the last collect (anchor for the fee-gated re-extend). */
  lastCollect?: number;
  /** Armed re-extend level after the leg was fully collected, if any. */
  reExtendAt?: number;
}

function freshBook(): BookState {
  return { anchor: 0, addLevels: [], step: 0, collectStep: 0 };
}

function startEpisode(account: Account, books: Record<Side, BookState>, bin: Bin1m, strategy: Strategy): void {
  const price = bin.close;
  const wallet = account.snapshot(price).wallet;
  const step = strategy.stepContracts(wallet, price);

  account.open('long', step, price);
  account.open('short', step, price);

  books.long = { anchor: price, step, collectStep: 0, addLevels: ladder(price, 'long', strategy) };
  books.short = { anchor: price, step, collectStep: 0, addLevels: ladder(price, 'short', strategy) };
}

/**
 * Resting extends spaced evenly from entry to entry ± ladderSpan (NOT to the
 * band edge — distant extends rarely help and worsen the loss near a range
 * exit).
 */
function ladder(entry: number, side: Side, strategy: Strategy): number[] {
  const steps = strategy.ladderSteps();
  const span = entry * strategy.ladderSpan() * (side === 'long' ? -1 : 1);
  const levels: number[] = [];

  for (let k = 1; k < steps; k++) {
    levels.push(entry + (span * k) / steps);
  }

  return levels;
}

/**
 * One bin of in-band trading for both books. Order of checks within the bin
 * is a naive approximation (adds before de-risks, long before short).
 * Returns the number of fills.
 */
function tradeBin(
  account: Account,
  books: Record<Side, BookState>,
  bin: Bin1m,
  strategy: Strategy,
  log: (t: string, type: string, detail: string) => void,
): number {
  let fills = 0;

  for (const side of ['long', 'short'] as Side[]) {
    const book = books[side];
    const snap = account.snapshot(bin.close);
    const leg = side === 'long' ? snap.long : snap.short;
    const sign = side === 'long' ? 1 : -1;
    const touched = (level: number) => (side === 'long' ? bin.low <= level : bin.high >= level);
    const favorable = (level: number) => (side === 'long' ? bin.high >= level : bin.low <= level);
    const maxSize = book.step * strategy.ladderSteps();
    const keepSize = Math.round(maxSize * strategy.deriskKeep());

    /** 1. Ladder extends (adverse movement). Entry moved → step collects reset. */
    while (book.addLevels.length > 0 && touched(book.addLevels[0])) {
      const level = book.addLevels.shift() as number;

      account.open(side, book.step, level);
      book.collectStep = 0;
      fills++;
      log(bin.t, 'extend', `${side} +${book.step} @ ${level}`);
    }

    /** 2. Breakeven de-risk of the excess above keepSize (favorable return). */
    if (leg.size > keepSize) {
      const level = leg.avgEntry * (1 + sign * strategy.breakevenBuffer());

      if (favorable(level)) {
        account.reduce(side, leg.size - keepSize, level);
        fills++;
        log(bin.t, 'derisk', `${side} -${leg.size - keepSize} @ ${level.toFixed(1)} (keep ${keepSize})`);
      }
    }

    /** 3. Step collects: C at entry ± (collectStart + k·collectSpacing) until consumed. */
    let legNow = side === 'long' ? account.snapshot(bin.close).long : account.snapshot(bin.close).short;

    while (legNow.size > 0) {
      const distance = strategy.collectStart() + book.collectStep * strategy.collectSpacing();
      const level = legNow.avgEntry * (1 + sign * distance);

      if (! favorable(level)) {
        break;
      }

      const size = Math.min(book.step, legNow.size);

      account.reduce(side, size, level);
      book.collectStep++;
      book.lastCollect = level;
      fills++;
      log(bin.t, 'collect', `${side} -${size} @ ${level.toFixed(1)} (step ${book.collectStep})`);
      legNow = side === 'long' ? account.snapshot(bin.close).long : account.snapshot(bin.close).short;
    }

    /** 4. Fee-gated re-extend once the leg is fully collected. */
    if (legNow.size === 0 && ! book.reExtendAt && book.lastCollect) {
      book.reExtendAt = book.lastCollect * (1 - sign * strategy.reEntry());
    }

    if (book.reExtendAt && touched(book.reExtendAt)) {
      account.open(side, book.step, book.reExtendAt);
      book.collectStep = 0;
      log(bin.t, 're-extend', `${side} +${book.step} @ ${book.reExtendAt.toFixed(1)}`);
      book.reExtendAt = undefined;
      fills++;
    }
  }

  return fills;
}

/** Balance the pair at `price`: freeze the loss (net-flat). */
function freeze(account: Account, price: number): number {
  const snap = account.snapshot(price);
  const diff = snap.long.size - snap.short.size;

  if (Math.abs(diff) < 100) {
    return 0;
  }

  account.open(diff > 0 ? 'short' : 'long', Math.abs(diff), price);

  return 1;
}

function pushWindow(arr: number[], value: number, max: number): void {
  arr.push(value);

  if (arr.length > max) {
    arr.shift();
  }
}

/** Entries gap (longEntry − shortEntry) as a fraction of price; NaN if a leg is empty. */
function entriesGap(snap: AccountSnapshot): number {
  if (snap.long.size === 0 || snap.short.size === 0) {
    return NaN;
  }

  return (snap.long.avgEntry - snap.short.avgEntry) / snap.price;
}

function freshRow(hour: string, bin: Bin1m, snap: AccountSnapshot, mode: SimMode): HourlyRow {
  const gap = entriesGap(snap);

  return {
    hour,
    priceMin: bin.low,
    priceMax: bin.high,
    walletMin: snap.wallet,
    walletMax: snap.wallet,
    equityMin: snap.equity,
    equityMax: snap.equity,
    uPnlMin: snap.uPnl,
    uPnlMax: snap.uPnl,
    availMin: snap.availableMargin,
    availMax: snap.availableMargin,
    gapMin: gap,
    gapMax: gap,
    realized: snap.realized,
    feesPaid: snap.feesPaid,
    trades: 0,
    mode,
  };
}

function updateRow(row: HourlyRow, bin: Bin1m, snap: AccountSnapshot, mode: SimMode, trades: number): void {
  row.priceMin = Math.min(row.priceMin, bin.low);
  row.priceMax = Math.max(row.priceMax, bin.high);
  row.walletMin = Math.min(row.walletMin, snap.wallet);
  row.walletMax = Math.max(row.walletMax, snap.wallet);
  row.equityMin = Math.min(row.equityMin, snap.equity);
  row.equityMax = Math.max(row.equityMax, snap.equity);
  row.uPnlMin = Math.min(row.uPnlMin, snap.uPnl);
  row.uPnlMax = Math.max(row.uPnlMax, snap.uPnl);
  row.availMin = Math.min(row.availMin, snap.availableMargin);
  row.availMax = Math.max(row.availMax, snap.availableMargin);

  const gap = entriesGap(snap);

  if (! Number.isNaN(gap)) {
    row.gapMin = Number.isNaN(row.gapMin) ? gap : Math.min(row.gapMin, gap);
    row.gapMax = Number.isNaN(row.gapMax) ? gap : Math.max(row.gapMax, gap);
  }

  row.realized = snap.realized;
  row.feesPaid = snap.feesPaid;
  row.trades = trades;
  row.mode = mode;
}
