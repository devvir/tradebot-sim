/** Bin sizing: fixed sizes plus the Auto rule that picks one from the visible span. */

export const AUTO = 'Auto';

/** Minutes per bin, for every explicit size. Ascending. */
const BIN_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '12h': 720,
  '1D': 1440,
  '3D': 4320,
  '1W': 10080,
  '1M': 43200,
};

/** How many candles Auto aims to show — enough to read structure, few enough to stay quick. */
const TARGET_CANDLES = 600;

/** Span floor so zooming in can never collapse the range to nothing. */
export const MIN_SPAN_MS = 2 * 60_000;

/**
 * Resolve a chosen bin to the concrete size to query. Explicit sizes pass
 * through; Auto picks the finest bin that keeps the candle count near target,
 * so zooming changes resolution the way the old auto-only chart did — now just
 * one option among the pinned sizes.
 */
export function resolveBin(bin: string, from: string, to: string): string {
  if (bin !== AUTO) {
    return bin;
  }

  const spanMin = (Date.parse(to) - Date.parse(from)) / 60_000;
  const wanted = spanMin / TARGET_CANDLES;
  const sizes = Object.entries(BIN_MINUTES);

  for (let i = sizes.length - 1; i >= 0; i--) {
    if (sizes[i][1] <= wanted) {
      return sizes[i][0];
    }
  }

  return '1m';
}
