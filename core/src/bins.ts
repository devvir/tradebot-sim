import type { BinSpec } from './types';

/**
 * The canonical bin ladder (docs/planning/BINS.md). One place defines every bin
 * size, the DuckDB interval that buckets it, and the cached base table it
 * aggregates from — used identically by the server (serving candles/series) and
 * the precompute (loading bars at an indicator's timeframe).
 *
 * A size whose source equals its own table (1m←tradeBin1m, …) aggregates as an
 * identity group-by. Sub-minute sizes compose from the generated 1s floor;
 * everything from 1m up composes from the nearest imported base. `1W` and `1M`
 * are calendar buckets (`INTERVAL '1 week'|'1 month'`), never fixed minutes.
 */
export const BIN_LADDER: Record<string, BinSpec> = {
  '1s': { interval: '1 second', source: 'tradeBin1s' },
  '30s': { interval: '30 seconds', source: 'tradeBin1s' },
  '1m': { interval: '1 minute', source: 'tradeBin1m' },
  '5m': { interval: '5 minutes', source: 'tradeBin5m' },
  '15m': { interval: '15 minutes', source: 'tradeBin5m' },
  '30m': { interval: '30 minutes', source: 'tradeBin5m' },
  '1h': { interval: '1 hour', source: 'tradeBin1h' },
  '4h': { interval: '4 hours', source: 'tradeBin1h' },
  '12h': { interval: '12 hours', source: 'tradeBin1h' },
  '1D': { interval: '1 day', source: 'tradeBin1d' },
  '3D': { interval: '3 days', source: 'tradeBin1d' },
  '1W': { interval: '1 week', source: 'tradeBin1d' },
  '1M': { interval: '1 month', source: 'tradeBin1d' },
};

/** Ordered bin sizes, finest first. */
export const BIN_SIZES: string[] = Object.keys(BIN_LADDER);

/** The ladder entry for a size, or undefined if the size is not on the ladder. */
export function binSpec(size: string): BinSpec | undefined {
  return BIN_LADDER[size];
}
