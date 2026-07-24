/**
 * Windowed series cache — the piece that makes panning and zooming feel instant.
 *
 * The chart asks for a visible range; this fetches a wider one and answers
 * every subsequent request that falls inside it from memory. Zooming *in* is
 * always a strict subset of what is loaded, so it never touches the network.
 *
 * Pure functions over a loaded window: no React, no fetch, no time. That keeps
 * the buffering rules in one place and testable, rather than smeared across the
 * components that happen to render the data.
 */

import type { Windowed } from './types';

/** How much context to load either side of the viewport, as a multiple of its span. */
const MARGIN = 1;

/** Refill when the viewport comes within this fraction of the buffer's edge. */
const EDGE = 0.25;

/** Widen a visible range into the range worth fetching. */
export function padded(from: number, to: number): { from: number; to: number } {
  const span = to - from;

  return { from: from - span * MARGIN, to: to + span * MARGIN };
}

/** Does the loaded window fully contain this range? */
export function covers(win: Windowed<unknown> | null, key: string, from: number, to: number): boolean {
  return win !== null && win.key === key && win.from <= from && win.to >= to;
}

/**
 * Is the viewport close enough to the buffer edge to warrant a background
 * refill? Only meaningful when the window still covers the range — this is the
 * prefetch trigger, not the fetch trigger.
 */
export function nearEdge(win: Windowed<unknown> | null, key: string, from: number, to: number): boolean {
  if (! covers(win, key, from, to)) {
    return false;
  }

  const w = win as Windowed<unknown>;
  const margin = (to - from) * EDGE;

  return from - w.from < margin || w.to - to < margin;
}

/** The rows of a loaded window that fall inside [from, to]. */
export function slice<T>(win: Windowed<T>, from: number, to: number): T[] {
  return win.rows.filter((_, i) => win.stamps[i] >= from && win.stamps[i] <= to);
}
