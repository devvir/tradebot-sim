import type { Command } from 'commander';
import type { BandParams } from '@poc/core';

/**
 * Band CLI surface, shared by the data CLI and the zone-viewer server so the
 * flag list and its parsing exist exactly once. The band series is a pure
 * function of bins + these params, and runs are cached by their hash — so a
 * drift between two copies of this list would silently split the cache.
 */
export const bandOptions = (cmd: Command): Command =>
  cmd
    .option('--outer-occ <frac>', 'outer band occupancy', '0.98')
    .option('--outer-leniency <x>', 'outer band width multiplier', '1.1')
    .option('--outer-cap <frac>', 'outer band width cap', '0.03')
    .option('--inner-width <frac>', 'max inner width (gate)', '0.02')
    .option('--merge-lookback <min>', 'temporal merge: bands(now) ∩ bands(now−N); 0 = off', '30')
    .option('--merge-weight-now <w>', 'merge weight of the current band (1 = full constraint)', '1')
    .option('--merge-weight-past <w>', 'merge weight of the past band', '1')
    .option('--jump-lookback <min>', 'jump check: inner must fit outer from N minutes ago', '60')
    .option('--expansion-lookback <min>', 'expansion check: width rolling-average window', '240')
    .option('--expansion-max <x>', 'expansion check: max width vs rolling average', '1.5')
    .option('--cross-cooldown <min>', 'gate closed for N minutes after close was outside the outer band', '72')
    .option('--outer-min-ratio <x>', 'working outer band at least this × inner width', '1.5');

export const bandParamsFrom = (o: Record<string, string>): BandParams => ({
  innerWindow: 360,
  innerOccupancy: 0.8,
  outerWindow: 360,
  outerOccupancy: parseFloat(o.outerOcc),
  outerLeniency: parseFloat(o.outerLeniency),
  maxInnerWidth: parseFloat(o.innerWidth),
  outerCap: parseFloat(o.outerCap),
  mergeLookback: parseInt(o.mergeLookback, 10),
  mergeWeightNow: parseFloat(o.mergeWeightNow),
  mergeWeightPast: parseFloat(o.mergeWeightPast),
  jumpLookback: parseInt(o.jumpLookback, 10),
  expansionLookback: parseInt(o.expansionLookback, 10),
  expansionMax: parseFloat(o.expansionMax),
  crossCooldown: parseInt(o.crossCooldown, 10),
  outerMinRatio: parseFloat(o.outerMinRatio),
});
