/**
 * Series shaping for display.
 *
 * Coarse indicators are cached aligned to the finest bin, so a 5m EMA repeats
 * the same value for five consecutive minutes. Plotting every stored point
 * therefore draws a staircase, where the flat runs are an artefact of
 * alignment rather than anything the indicator did.
 *
 * These helpers are display-only. The stored series keeps every point, and a
 * strategy must still read the held value — interpolating between updates
 * would mean using a value that was not knowable at the time.
 */

import type { ApiPoint } from '@poc/core';

/**
 * Keep only the points where the value changes, plus the last one.
 *
 * The result is the polyline through the instants the indicator actually
 * updated; the renderer's straight segments join them. A series that changes
 * every point (a 1m indicator on a 1m chart) is returned unchanged.
 */
export function changePoints(points: ApiPoint[]): ApiPoint[] {
  if (points.length < 3) {
    return points;
  }

  const out: ApiPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    /** Keep every gap boundary: a null starts a new segment on either side. */
    if (i === 0 || i === points.length - 1 || p.v !== points[i - 1].v) {
      out.push(p);
    }
  }

  return out;
}
