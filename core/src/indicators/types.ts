import type { Bin1m } from '../types';

/**
 * A prototyping indicator: a pure function of the static bins → a per-bin
 * series, plus display metadata. Add one by appending a spec to the registry;
 * discard one by deleting it — nothing else is affected. Precomputed once and
 * cached; never recomputed in a hot path (POC.md: precompute over real-time).
 */
export interface IndicatorSpec {
  /**
   * Stable id and cache filename, by convention `<family>_<params>_<tf>`
   * (e.g. `ema_50_1m`, `emaspread_20-50_5m`, `rvol_60_1m`). Greppable and
   * parseable, but generic code should key off the structured fields below,
   * not parse the id.
   */
  id: string;
  label: string;
  /** Structured metadata so loading/display code stays generic (group, filter). */
  family: string;
  /** Primary timeframe: '1m' | '5m' | '15m' (composites note both in label). */
  tf: string;
  /** 'price' overlays the candle pane; any other string names a sub-pane. */
  pane: string;
  kind: 'line' | 'area';
  color: string;
  defaultVisible: boolean;
  /**
   * Whether this indicator is meant to be precomputed to disk. `true` for the
   * moving averages and every windowed/recursive family; `false` for the ones
   * derived on read from other cached series (cross-timeframe spreads, etc.).
   * The UI must not warn that a `cached: false` indicator is absent from disk.
   */
  cached: boolean;
  /**
   * One value per input bar, aligned 1:1 to the bars of THIS indicator's `tf`
   * (not to 1m); null during warmup / gaps. The loader hands `compute` bars
   * already aggregated to `tf` from the nearest cached base, so the function is
   * a plain series computation with no internal resampling.
   */
  compute: (bins: Bin1m[]) => (number | null)[];
}

/** A computed indicator series, aligned to the bins it was computed over. */
export interface IndicatorSeries {
  id: string;
  values: (number | null)[];
}
