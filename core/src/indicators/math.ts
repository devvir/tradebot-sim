import type { Bin1m } from '../types';

/** Simple moving average over `period`; null until `period` samples seen. */
export function sma(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);

  let sum = 0;

  for (let i = 0; i < series.length; i++) {
    sum += series[i];

    if (i >= period) {
      sum -= series[i - period];
    }

    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }

  return out;
}

/** Exponential moving average over `period`, seeded with the SMA of the first
 *  `period` samples; null before the seed. */
export function ema(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  const k = 2 / (period + 1);

  let prev = 0;
  let seedSum = 0;
  let seeded = false;

  for (let i = 0; i < series.length; i++) {
    if (! seeded) {
      seedSum += series[i];

      if (i === period - 1) {
        prev = seedSum / period;
        out[i] = prev;
        seeded = true;
      }

      continue;
    }

    prev = series[i] * k + prev * (1 - k);
    out[i] = prev;
  }

  return out;
}

/** Slope of a (nullable) series over `window` bars: (v[i] − v[i−window]) / window. */
export function slope(series: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);

  for (let i = window; i < series.length; i++) {
    const a = series[i];
    const b = series[i - window];

    if (a !== null && b !== null) {
      out[i] = (a - b) / window;
    }
  }

  return out;
}

/** Elementwise difference of two aligned nullable series (a − b). */
export function diff(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  return a.map((v, i) => (v !== null && b[i] !== null ? v - (b[i] as number) : null));
}

/**
 * The one-liner building block: EMA of `period` over `tfMin`-minute closes,
 * returned aligned to the 1m timeline. This is what makes a new indicator a
 * single expression — e.g. `diff(emaTF(bins,100,1), emaTF(bins,200,15))`.
 */
export function emaTF(bins: Bin1m[], period: number, tfMin: number): (number | null)[] {
  if (tfMin <= 1) {
    return ema(
      bins.map((b) => b.close),
      period,
    );
  }

  const { closes, expand } = resample(bins, tfMin);

  return expand(ema(closes, period));
}

/** Rolling population standard deviation over `window`; null until filled. */
export function stdev(series: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);

  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    sumSq += series[i] * series[i];

    if (i >= window) {
      const o = series[i - window];

      sum -= o;
      sumSq -= o * o;
    }

    if (i >= window - 1) {
      const mean = sum / window;

      out[i] = Math.sqrt(Math.max(0, sumSq / window - mean * mean));
    }
  }

  return out;
}

/** Per-bar log returns of a close series (0 at the first bar). */
export function logReturns(closes: number[]): number[] {
  const out = new Array(closes.length).fill(0);

  for (let i = 1; i < closes.length; i++) {
    out[i] = closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : 0;
  }

  return out;
}

/** Realized volatility: rolling stdev of log returns (a speed metric). */
export function realizedVol(closes: number[], window: number): (number | null)[] {
  return stdev(logReturns(closes), window);
}

/** ATR: SMA of true range over `period`, relative to close (fraction). */
export function atr(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const tr = new Array(closes.length).fill(0);

  for (let i = 0; i < closes.length; i++) {
    tr[i] =
      i === 0
        ? highs[i] - lows[i]
        : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }

  return sma(tr, period).map((v, i) => (v === null || closes[i] <= 0 ? null : v / closes[i]));
}

/** Relative return over `n` bars: (close[i] − close[i−n]) / close[i−n]. */
export function returnN(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = n; i < closes.length; i++) {
    out[i] = closes[i - n] > 0 ? (closes[i] - closes[i - n]) / closes[i - n] : null;
  }

  return out;
}

/**
 * Group 1m bins into `tf`-minute buckets (consecutive) → bucket closes + an
 * `expand` that lifts a per-bucket series back onto the 1m timeline. Consecutive
 * grouping ignores minute gaps; fine for prototyping on dense XBTUSD bins.
 */
/**
 * Clock-aligned resampling.
 *
 * Buckets are decided by each bin's timestamp, never by its position in the
 * array. Position-based bucketing (`i += tf`) anchors every bucket to wherever
 * the symbol's data happens to start and lets a gap stretch a bucket across
 * arbitrary wall-clock time, so a "5m EMA" is not computed on 5-minute bars at
 * all.
 *
 * Stamps are end-labelled throughout the dataset, so a 1m bin stamped 11:05
 * closes the 5m bucket stamped 11:05, and one stamped 11:06 opens the next.
 * That is `floor(t - 1ms) + tf` — the same rule the API uses to aggregate bins.
 */
export function bucketEnds(bins: Bin1m[], tfMin: number): number[] {
  const tfMs = tfMin * 60_000;

  return bins.map((b) => {
    const t = Date.parse(b.t);

    return Math.floor((t - 1) / tfMs) * tfMs + tfMs;
  });
}

/**
 * Map a per-bucket series back onto per-bin positions.
 *
 * A bin may only see a bucket that has closed at or before the bin's own
 * timestamp — the lookahead rule. Since a bin's stamp is the close of its own
 * minute, a bin lands on a bucket boundary exactly when it is that bucket's
 * final bin, and sees it then; every other bin sees the previous bucket.
 * Gaps therefore delay a value rather than fabricating one.
 */
function clockExpander(
  stamps: number[],
  ends: number[],
): (bucketSeries: (number | null)[]) => (number | null)[] {
  const index: number[] = [];

  let bucket = -1;

  for (let i = 0; i < ends.length; i++) {
    if (i === 0 || ends[i] !== ends[i - 1]) {
      bucket++;
    }

    index.push(bucket);
  }

  return (bucketSeries) => {
    const out: (number | null)[] = new Array(ends.length).fill(null);

    for (let i = 0; i < ends.length; i++) {
      /**
       * A bin sees its own bucket only when that bucket closes at the bin's own
       * stamp; otherwise the newest closed bucket is the previous one. Testing
       * the clock rather than "is this the last bin present" matters at the
       * tail: when data ends mid-bucket, that bucket is computed but must stay
       * invisible, because it is not finished.
       */
      const visible = ends[i] === stamps[i] ? index[i] : index[i] - 1;

      if (visible >= 0 && visible < bucketSeries.length) {
        out[i] = bucketSeries[visible];
      }
    }

    return out;
  };
}

export function resample(
  bins: Bin1m[],
  tf: number,
): { closes: number[]; expand: (bucketSeries: (number | null)[]) => (number | null)[] } {
  const stamps = bins.map((b) => Date.parse(b.t));
  const ends = bucketEnds(bins, tf);
  const closes: number[] = [];

  for (let i = 0; i < bins.length; i++) {
    if (i === bins.length - 1 || ends[i + 1] !== ends[i]) {
      closes.push(bins[i].close);
    }
  }

  return { closes, expand: clockExpander(stamps, ends) };
}

/**
 * Rolling VWAP over `n` bars: Σ(binVWAP·vol) / Σ(vol). Exact from bins because
 * binVWAP·binVol recovers that bin's Σ(price·volume).
 */
export function rollingVwap(vwaps: number[], vols: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(vwaps.length).fill(null);
  const pv = vwaps.map((v, i) => v * vols[i]);

  let sumPV = 0;
  let sumV = 0;

  for (let i = 0; i < vwaps.length; i++) {
    sumPV += pv[i];
    sumV += vols[i];

    if (i >= n) {
      sumPV -= pv[i - n];
      sumV -= vols[i - n];
    }

    if (i >= n - 1) {
      out[i] = sumV > 0 ? sumPV / sumV : null;
    }
  }

  return out;
}

/** Session VWAP, cumulative within each UTC day (reset at midnight). `times`
 *  are the bin ISO timestamps; the date prefix (chars 0–10) marks the session. */
export function sessionVwap(times: string[], vwaps: number[], vols: number[]): (number | null)[] {
  const out: (number | null)[] = new Array(vwaps.length).fill(null);

  let sumPV = 0;
  let sumV = 0;
  let day = '';

  for (let i = 0; i < vwaps.length; i++) {
    const d = times[i].slice(0, 10);

    if (d !== day) {
      day = d;
      sumPV = 0;
      sumV = 0;
    }

    sumPV += vwaps[i] * vols[i];
    sumV += vols[i];
    out[i] = sumV > 0 ? sumPV / sumV : null;
  }

  return out;
}

/** Full multi-field resample (aggregated OHLCV + trades) with the same expand. */
/**
 * Resampling is memoised per (bins array, timeframe).
 *
 * A symbol's run computes every indicator against the same bins array, and
 * ~150 indicators share ~13 timeframes — so without this each timeframe is
 * rebuilt a dozen times, and resampling dominates the cost (measured: a 1m
 * indicator takes 0.9 s where a 1h one takes 2.9 s, the difference being the
 * resample). Keyed weakly on the array, so it is released with the bins.
 */
const resampleCache = new WeakMap<Bin1m[], Map<number, ResampledBins>>();

interface ResampledBins {
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  trades: number[];
  expand: (bucketSeries: (number | null)[]) => (number | null)[];
}

export function resampleBins(
  bins: Bin1m[],
  tf: number,
): ResampledBins {
  const cached = resampleCache.get(bins)?.get(tf);

  if (cached) {
    return cached;
  }

  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  const trades: number[] = [];
  const stamps = bins.map((b) => Date.parse(b.t));
  const ends = bucketEnds(bins, tf);

  let h = -Infinity;
  let l = Infinity;
  let v = 0;
  let tr = 0;

  /** One pass, closing a bucket whenever the next bin belongs to a later one. */
  for (let i = 0; i < bins.length; i++) {
    h = Math.max(h, bins[i].high);
    l = Math.min(l, bins[i].low);
    v += bins[i].volume;
    tr += bins[i].trades;

    if (i === bins.length - 1 || ends[i + 1] !== ends[i]) {
      high.push(h);
      low.push(l);
      close.push(bins[i].close);
      volume.push(v);
      trades.push(tr);

      h = -Infinity;
      l = Infinity;
      v = 0;
      tr = 0;
    }
  }

  const result: ResampledBins = { high, low, close, volume, trades, expand: clockExpander(stamps, ends) };
  const perTf = resampleCache.get(bins) ?? new Map<number, ResampledBins>();

  perTf.set(tf, result);
  resampleCache.set(bins, perTf);

  return result;
}
