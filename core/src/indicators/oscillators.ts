import { ema, sma, stdev } from './math';

/** Per-bar true range (absolute). */
export function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const tr = new Array(closes.length).fill(0);

  for (let i = 0; i < closes.length; i++) {
    tr[i] =
      i === 0
        ? highs[i] - lows[i]
        : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }

  return tr;
}

/** RSI (Wilder's smoothing), 0–100; null until `period` seen. */
export function rsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;

    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;

      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }

      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

/** Stochastic %K: close position within the rolling high–low range, 0–100. */
export function stochasticK(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;

    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) {
        hh = highs[j];
      }

      if (lows[j] < ll) {
        ll = lows[j];
      }
    }

    out[i] = hh > ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50;
  }

  return out;
}

/** Donchian channel width, relative to close (rolling max-high − min-low)/close. */
export function donchianWidth(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;

    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) {
        hh = highs[j];
      }

      if (lows[j] < ll) {
        ll = lows[j];
      }
    }

    out[i] = closes[i] > 0 ? (hh - ll) / closes[i] : null;
  }

  return out;
}

/**
 * Choppiness Index (0–100): high (>~62) = ranging/consolidation (scalp-friendly),
 * low (<~38) = trending (dangerous). = 100·log10(ΣTR / (HH−LL)) / log10(period).
 */
export function choppiness(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const tr = trueRange(highs, lows, closes);
  const out: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    let sumTr = 0;
    let hh = -Infinity;
    let ll = Infinity;

    for (let j = i - period + 1; j <= i; j++) {
      sumTr += tr[j];

      if (highs[j] > hh) {
        hh = highs[j];
      }

      if (lows[j] < ll) {
        ll = lows[j];
      }
    }

    const range = hh - ll;

    out[i] = range > 0 && sumTr > 0 ? (100 * Math.log10(sumTr / range)) / Math.log10(period) : null;
  }

  return out;
}

/** Kaufman efficiency ratio: |net move| / total path over `period`; 0 choppy → 1 trending. */
export function efficiencyRatio(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period; i < closes.length; i++) {
    const net = Math.abs(closes[i] - closes[i - period]);

    let path = 0;

    for (let j = i - period + 1; j <= i; j++) {
      path += Math.abs(closes[j] - closes[j - 1]);
    }

    out[i] = path > 0 ? net / path : null;
  }

  return out;
}

/** Bollinger %B: close position within SMA±k·σ (0 = lower band, 1 = upper). */
export function bollingerPercentB(closes: number[], period: number, k: number): (number | null)[] {
  const mid = sma(closes, period);
  const sd = stdev(closes, period);

  return closes.map((c, i) => {
    const m = mid[i];
    const s = sd[i];

    if (m === null || s === null || s === 0) {
      return null;
    }

    return (c - (m - k * s)) / (2 * k * s);
  });
}

/**
 * Schaff Trend Cycle: a stochastic applied to MACD, double-smoothed — a fast
 * 0–100 trend-cycle oscillator. Canonical construction (Schaff): MACD → %K over
 * `cycle` → smooth by `factor` → %K again → smooth. Lower lag than MACD; more
 * parameters, so treat as a candidate to validate, not a given.
 */
export function schaffTrendCycle(
  closes: number[],
  fast = 23,
  slow = 50,
  cycle = 10,
  factor = 0.5,
): (number | null)[] {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const macd = closes.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));

  const stochOver = (s: (number | null)[], n: number): (number | null)[] =>
    s.map((_, i) => {
      if (i < n - 1) {
        return null;
      }

      let mn = Infinity;
      let mx = -Infinity;

      for (let j = i - n + 1; j <= i; j++) {
        const v = s[j];

        if (v === null) {
          return null;
        }

        if (v < mn) {
          mn = v;
        }

        if (v > mx) {
          mx = v;
        }
      }

      return mx > mn ? ((s[i] as number) - mn) / (mx - mn) * 100 : 50;
    });

  const smooth = (s: (number | null)[]): (number | null)[] => {
    const out: (number | null)[] = new Array(s.length).fill(null);

    let prev: number | null = null;

    for (let i = 0; i < s.length; i++) {
      const v = s[i];

      if (v === null) {
        continue;
      }

      prev = prev === null ? v : prev + factor * (v - prev);
      out[i] = prev;
    }

    return out;
  };

  return smooth(stochOver(smooth(stochOver(macd, cycle)), cycle));
}

/** MACD histogram: (EMA_fast − EMA_slow) − EMA_signal of that line. */
export function macdHistogram(closes: number[], fast: number, slow: number, signal: number): (number | null)[] {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: (number | null)[] = closes.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));

  /** Signal = EMA of the (nullable) MACD line, started where it becomes defined. */
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const kk = 2 / (signal + 1);

  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;

  for (let i = 0; i < line.length; i++) {
    const v = line[i];

    if (v === null) {
      continue;
    }

    if (prev === null) {
      seedSum += v;
      seedCount++;

      if (seedCount === signal) {
        prev = seedSum / signal;
        out[i] = v - prev;
      }

      continue;
    }

    prev = v * kk + prev * (1 - kk);
    out[i] = v - prev;
  }

  return out;
}
