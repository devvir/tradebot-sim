/**
 * Axis ticks: round numbers a human reads without effort, at a density that
 * suits the viewport rather than a fixed count.
 */

/** Time steps the axis is allowed to use, in ms. Each is a boundary people expect. */
const TIME_STEPS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3600_000,
  4 * 3600_000,
  12 * 3600_000,
  86_400_000,
  7 * 86_400_000,
  28 * 86_400_000,
  91 * 86_400_000,
  365 * 86_400_000,
];

/**
 * A "nice" step covering `range` in roughly `target` intervals — 1, 2 or 5
 * times a power of ten, so labels land on values like 50, 200, 2500.
 *
 * Rounds to the nearest such value rather than up: rounding up overshoots and
 * leaves the axis sparse (a range of 37 over 6 intervals would jump to a step
 * of 10, giving 4 gridlines instead of 7).
 */
export function niceStep(range: number, target: number): number {
  if (range <= 0 || target <= 0) {
    return 1;
  }

  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;

  return mag * (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10);
}

/** Round price levels spanning [lo, hi]. */
export function priceTicks(lo: number, hi: number, target = 6): number[] {
  if (! Number.isFinite(lo) || ! Number.isFinite(hi) || hi <= lo) {
    return [];
  }

  const step = niceStep(hi - lo, target);
  const out: number[] = [];

  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    out.push(Number(v.toFixed(10)));
  }

  return out;
}

/**
 * Time levels spanning [from, to], aligned to a natural boundary — minutes,
 * hours, days — so gridlines fall on times that mean something.
 */
export function timeTicks(from: number, to: number, target = 6): number[] {
  if (to <= from) {
    return [];
  }

  const span = to - from;
  const step = TIME_STEPS.find((s) => span / s <= target) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const out: number[] = [];

  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    out.push(t);
  }

  return out;
}

/** Decimals needed so consecutive ticks are distinguishable. */
export function tickDecimals(step: number): number {
  if (step >= 10) {
    return 0;
  }

  return Math.min(8, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
}
