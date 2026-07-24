import { atr, diff, ema, realizedVol, returnN, rollingVwap, sessionVwap, sma, slope } from './math';
import {
  bollingerPercentB,
  choppiness,
  donchianWidth,
  efficiencyRatio,
  macdHistogram,
  rsi,
  schaffTrendCycle,
  stochasticK,
} from './oscillators';

import { BIN_SIZES } from '../bins';

import type { Bin1m } from '../types';
import type { IndicatorSpec } from './types';

/**
 * The indicator registry — generated from parameter loops, not hand-repeated.
 *
 * Naming convention (id = `<family>_<params>_<tf>`; greppable + parseable):
 *   ema_50_1m · sma_200_5m · emaslope_20_5m · emaspread_20-50_1m ·
 *   rvol_60_1m · atr_14_5m · ret_15_1m · volema_20_5m · vwapdev_1m
 * Generic code (precompute, serve, UI grouping) keys off the structured
 * `family`/`tf`/`pane` fields — it never parses the id and never repeats
 * per-indicator logic. Adding a family or a period is editing a loop here;
 * everything downstream picks it up. All hidden by default — the point is a
 * clean catalog to draw from, not a cluttered view.
 *
 * **Bars are at the indicator's own timeframe.** Every `compute` receives bars
 * already aggregated to its `tf` from the nearest cached base (the loader does
 * this via the bin ladder), so an indicator is a plain series computation — no
 * internal resampling, no minute maps. A `1W` EMA sees ~weekly bars; a `1s` EMA
 * sees 1s bars; the function is identical.
 */

const TF: string[] = ['1m', '5m', '15m'];

/**
 * Periods for the moving averages.
 *
 * Averages get the full bin ladder (BIN_SIZES: 1s…1M) because they are the
 * reference every other reading is taken against, one wants the same average at
 * whatever resolution the chart is on, and they are tiny (a list of numbers,
 * stored sparse). Other families stay on `TF` — multiplying all of them by
 * thirteen would be catalogue bloat, not coverage; give a family the ladder
 * case by case when a use calls for it.
 */
const MA_PERIODS = [9, 20, 50, 100, 200];

const COLORS = ['#3987e5', '#199e70', '#d55181', '#c98500', '#d95926', '#9085e9', '#2ab7ca', '#e66767'];
const colorFor = (i: number) => COLORS[i % COLORS.length];

/** Column extractors — every compute works off these off the tf-bars. */
const closes = (b: Bin1m[]) => b.map((x) => x.close);
const highs = (b: Bin1m[]) => b.map((x) => x.high);
const lows = (b: Bin1m[]) => b.map((x) => x.low);

function build(): IndicatorSpec[] {
  const out: IndicatorSpec[] = [];

  /** Moving averages: {SMA,EMA} × {9,20,50,100,200} × 13 ladder sizes. */
  MA_PERIODS.forEach((p, pi) => {
    for (const tf of BIN_SIZES) {
      out.push({
        id: `ema_${p}_${tf}`,
        label: `EMA${p} ${tf}`,
        family: 'ema',
        tf,
        pane: 'price',
        kind: 'line',
        color: colorFor(pi),
        defaultVisible: false,
        cached: true,
        compute: (b) => ema(closes(b), p),
      });

      out.push({
        id: `sma_${p}_${tf}`,
        label: `SMA${p} ${tf}`,
        family: 'sma',
        tf,
        pane: 'price',
        kind: 'line',
        color: colorFor(pi + 1),
        defaultVisible: false,
        cached: true,
        compute: (b) => sma(closes(b), p),
      });
    }
  });

  /** EMA slopes: {20,50} × TF — a sharp turn in the fast avg is a signal. */
  [20, 50].forEach((p, pi) => {
    for (const tf of TF) {
      out.push({
        id: `emaslope_${p}_${tf}`,
        label: `EMA${p} ${tf} slope`,
        family: 'ema-slope',
        tf,
        pane: `slope_${tf}`,
        kind: 'line',
        color: colorFor(pi),
        defaultVisible: false,
        cached: true,
        compute: (b) => slope(ema(closes(b), p), 1),
      });
    }
  });

  /** Fast−slow EMA spreads (same tf): momentum via divergence. */
  ([[20, 50], [50, 200]] as const).forEach(([fast, slow], si) => {
    for (const tf of ['1m', '5m']) {
      out.push({
        id: `emaspread_${fast}-${slow}_${tf}`,
        label: `EMA${fast}−${slow} ${tf}`,
        family: 'ema-spread',
        tf,
        pane: `spread_${tf}`,
        kind: 'line',
        color: colorFor(si),
        defaultVisible: false,
        cached: true,
        compute: (b) => diff(ema(closes(b), fast), ema(closes(b), slow)),
      });
    }
  });

  /** Realized volatility (speed): {30,60} × {1m,5m}. */
  [30, 60].forEach((w, wi) => {
    for (const tf of ['1m', '5m']) {
      out.push({
        id: `rvol_${w}_${tf}`,
        label: `RealizedVol ${w} ${tf}`,
        family: 'volatility',
        tf,
        pane: 'vol',
        kind: 'area',
        color: colorFor(wi),
        defaultVisible: false,
        cached: true,
        compute: (b) => realizedVol(closes(b), w),
      });
    }
  });

  /** ATR (range/speed): 14 × {1m,5m}. */
  for (const tf of ['1m', '5m']) {
    out.push({
      id: `atr_14_${tf}`,
      label: `ATR14 ${tf}`,
      family: 'atr',
      tf,
      pane: 'vol',
      kind: 'line',
      color: '#c98500',
      defaultVisible: false,
      cached: true,
      compute: (b) => atr(highs(b), lows(b), closes(b), 14),
    });
  }

  /** Returns (speed): {5,15} × 1m. */
  [5, 15].forEach((n, ni) => {
    out.push({
      id: `ret_${n}_1m`,
      label: `Return ${n} 1m`,
      family: 'return',
      tf: '1m',
      pane: 'ret',
      kind: 'line',
      color: colorFor(ni),
      defaultVisible: false,
      cached: true,
      compute: (b) => returnN(closes(b), n),
    });
  });

  /** Volume EMA (activity/resistance context): 20 × {1m,5m}. */
  for (const tf of ['1m', '5m']) {
    out.push({
      id: `volema_20_${tf}`,
      label: `Volume EMA20 ${tf}`,
      family: 'volume',
      tf,
      pane: 'volume',
      kind: 'area',
      color: '#2ab7ca',
      defaultVisible: false,
      cached: true,
      compute: (b) => ema(b.map((x) => x.volume), 20),
    });
  }

  /** Trade-count EMA (activity): 20 × 1m. */
  out.push({
    id: 'tradesema_20_1m',
    label: 'Trades EMA20 1m',
    family: 'activity',
    tf: '1m',
    pane: 'activity',
    kind: 'area',
    color: '#9085e9',
    defaultVisible: false,
    cached: true,
    compute: (b) => ema(b.map((x) => x.trades), 20),
  });

  /** Per-minute VWAP deviation (close vs the bar's own VWAP). */
  out.push({
    id: 'vwapdev_1m',
    family: 'vwap-dev',
    label: 'VWAP dev 1m (per-bin)',
    tf: '1m',
    pane: 'vwapdev',
    kind: 'line',
    color: '#d55181',
    defaultVisible: false,
    cached: true,
    compute: (b) => b.map((x) => (x.vwap > 0 ? (x.close - x.vwap) / x.vwap : null)),
  });

  // ── VWAP lines — the institutional fair-value benchmark (bins-exact) ─────

  /** Session VWAP, anchored to UTC midnight — the classic fair-value line. */
  out.push({
    id: 'vwap_session_1m',
    family: 'vwap',
    label: 'Session VWAP (UTC-daily)',
    tf: '1m',
    pane: 'price',
    kind: 'line',
    color: '#c98500',
    defaultVisible: false,
    cached: true,
    compute: (b) => sessionVwap(b.map((x) => x.t), b.map((x) => x.vwap), b.map((x) => x.volume)),
  });

  /** Rolling VWAP — adaptive intraday fair-value mean. */
  for (const [n, tag] of [[60, '60'], [240, '240']] as const) {
    out.push({
      id: `vwap_roll_${tag}_1m`,
      family: 'vwap',
      label: `Rolling VWAP ${tag}m`,
      tf: '1m',
      pane: 'price',
      kind: 'line',
      color: n === 60 ? '#199e70' : '#3987e5',
      defaultVisible: false,
      cached: true,
      compute: (b) => rollingVwap(b.map((x) => x.vwap), b.map((x) => x.volume), n),
    });
  }

  /** Deviation of close from SESSION VWAP — the meaningful mean-reversion / regime read. */
  out.push({
    id: 'vwapdist_session_1m',
    family: 'vwap-dev',
    label: 'Close − session VWAP (frac)',
    tf: '1m',
    pane: 'vwapdist',
    kind: 'line',
    color: '#d95926',
    defaultVisible: false,
    cached: true,
    compute: (b) => {
      const sv = sessionVwap(b.map((x) => x.t), b.map((x) => x.vwap), b.map((x) => x.volume));

      return b.map((x, i) => (sv[i] && sv[i]! > 0 ? (x.close - sv[i]!) / sv[i]! : null));
    },
  });

  // ── Oscillators / range context (classic TA, bins-native) ───────────────

  /** RSI 14 (mean reversion): {1m,5m}. */
  for (const tf of ['1m', '5m']) {
    out.push({
      id: `rsi_14_${tf}`,
      family: 'rsi',
      label: `RSI14 ${tf}`,
      tf,
      pane: 'rsi',
      kind: 'line',
      color: '#3987e5',
      defaultVisible: false,
      cached: true,
      compute: (b) => rsi(closes(b), 14),
    });
  }

  /** Stochastic %K 14 (position in range): {1m,5m}. */
  for (const tf of ['1m', '5m']) {
    out.push({
      id: `stoch_14_${tf}`,
      family: 'stochastic',
      label: `Stoch %K14 ${tf}`,
      tf,
      pane: 'stoch',
      kind: 'line',
      color: '#199e70',
      defaultVisible: false,
      cached: true,
      compute: (b) => stochasticK(highs(b), lows(b), closes(b), 14),
    });
  }

  /** Choppiness Index 14 (ranging↑ vs trending↓ — core signal): {1m,5m}. */
  for (const tf of ['1m', '5m']) {
    out.push({
      id: `chop_14_${tf}`,
      family: 'choppiness',
      label: `Choppiness14 ${tf}`,
      tf,
      pane: 'chop',
      kind: 'area',
      color: '#c98500',
      defaultVisible: false,
      cached: true,
      compute: (b) => choppiness(highs(b), lows(b), closes(b), 14),
    });
  }

  /** Kaufman Efficiency Ratio 10 (trendiness — core signal): {1m,5m}. */
  for (const tf of ['1m', '5m']) {
    out.push({
      id: `effratio_10_${tf}`,
      family: 'efficiency',
      label: `EfficiencyRatio10 ${tf}`,
      tf,
      pane: 'eff',
      kind: 'area',
      color: '#d95926',
      defaultVisible: false,
      cached: true,
      compute: (b) => efficiencyRatio(closes(b), 10),
    });
  }

  /** Donchian width 20 (range envelope width), 1m. */
  out.push({
    id: 'donchianw_20_1m',
    family: 'donchian',
    label: 'Donchian width 20 1m',
    tf: '1m',
    pane: 'donchian',
    kind: 'area',
    color: '#9085e9',
    defaultVisible: false,
    cached: true,
    compute: (b) => donchianWidth(highs(b), lows(b), closes(b), 20),
  });

  /** Bollinger %B 20/2 (position within bands), 1m. */
  out.push({
    id: 'bbpctb_20_1m',
    family: 'bollinger',
    label: 'Bollinger %B 20 1m',
    tf: '1m',
    pane: 'bbands',
    kind: 'line',
    color: '#2ab7ca',
    defaultVisible: false,
    cached: true,
    compute: (b) => bollingerPercentB(closes(b), 20, 2),
  });

  /** MACD histogram 12/26/9, 1m. */
  out.push({
    id: 'macdhist_12-26-9_1m',
    family: 'macd',
    label: 'MACD hist 12/26/9 1m',
    tf: '1m',
    pane: 'macd',
    kind: 'area',
    color: '#e66767',
    defaultVisible: false,
    cached: true,
    compute: (b) => macdHistogram(closes(b), 12, 26, 9),
  });

  /** Schaff Trend Cycle 23/50/10 — fast 0–100 trend-onset oscillator, 1m + 5m. */
  for (const tf of ['1m', '5m'] as const) {
    out.push({
      id: `stc_23-50-10_${tf}`,
      family: 'stc',
      label: `STC 23/50/10 ${tf}`,
      tf,
      pane: 'stc',
      kind: 'line',
      color: tf === '1m' ? '#8e44ad' : '#c39bd3',
      defaultVisible: false,
      cached: true,
      compute: (b) => schaffTrendCycle(closes(b), 23, 50, 10),
    });
  }

  // ── Volume / flow proxies (bins-level; true versions need trades) ────────

  /** Average trade size (volume/trades), EMA20 — participant-size proxy, 1m. */
  out.push({
    id: 'avgtradesize_20_1m',
    family: 'avg-trade-size',
    label: 'Avg trade size EMA20 1m',
    tf: '1m',
    pane: 'tradesize',
    kind: 'area',
    color: '#c98500',
    defaultVisible: false,
    cached: true,
    compute: (b) => ema(b.map((x) => (x.trades > 0 ? x.volume / x.trades : 0)), 20),
  });

  /** Volume-per-range (volume / (high−low)), EMA20 — bins-level resistance proxy, 1m. */
  out.push({
    id: 'volperrange_20_1m',
    family: 'resistance',
    label: 'Volume/range EMA20 1m',
    tf: '1m',
    pane: 'resistance',
    kind: 'area',
    color: '#d55181',
    defaultVisible: false,
    cached: true,
    compute: (b) => ema(b.map((x) => (x.high > x.low ? x.volume / (x.high - x.low) : 0)), 20),
  });

  /** Net volume flow (close-direction × volume), EMA20 — bounded OBV, 1m. */
  out.push({
    id: 'netflow_20_1m',
    family: 'flow',
    label: 'Net volume flow EMA20 1m',
    tf: '1m',
    pane: 'flow',
    kind: 'area',
    color: '#199e70',
    defaultVisible: false,
    cached: true,
    compute: (b) => {
      const signed = b.map((x, i) => (i === 0 ? 0 : Math.sign(x.close - b[i - 1].close) * x.volume));

      return ema(signed, 20);
    },
  });

  return out;
}

export const INDICATORS: IndicatorSpec[] = build();
