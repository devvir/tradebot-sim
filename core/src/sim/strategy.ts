import { BandGateTracker, computeBands } from './bands';

import type { BandsResult, SimParams, Strategy } from '../types';

/**
 * The naive v1 strategy: every knob is a function so that later iterations
 * can compute values (periodic range updates, volatility-scaled sizing,
 * dynamic take-profit) without the engine changing shape. Today they return
 * the configured constants; bands refresh on a cadence.
 */
export function naiveStrategy(params: SimParams): Strategy {
  let cached: BandsResult | undefined;
  let cachedAt = -Infinity;
  const tracker = new BandGateTracker(params.bands, 1);

  return {
    bands(closes, lows, highs, minuteIndex) {
      if (closes.length < params.bands.innerWindow) {
        return undefined;
      }

      if (minuteIndex - cachedAt >= params.bandRefreshMin) {
        cached = tracker.update(computeBands(closes, lows, highs, params.bands), closes[closes.length - 1]);
        cachedAt = minuteIndex;
      }

      return cached;
    },

    /** Nearest 100-USD lot, NO minimum: 0 = unsizable (wallet too small for the min lot at this price — skip, never inflate). */
    stepContracts(wallet, price) {
      const usd = params.baseLeverage * wallet * price;

      return Math.round(usd / 100) * 100;
    },

    ladderSpan: () => params.ladderSpan,
    deriskKeep: () => params.deriskKeep,
    collectStart: () => params.collectStart,
    collectSpacing: () => params.collectSpacing,
    reEntry: () => params.reEntry,
    breakevenBuffer: () => params.breakevenBuffer,
    bustFloor: () => params.bustThreshold * params.initialWallet,
    ladderSteps: () => Math.round(params.maxLeverage / params.baseLeverage),
  };
}
