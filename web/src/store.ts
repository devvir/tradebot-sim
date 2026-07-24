import { useSyncExternalStore } from 'react';

import { AUTO } from './bins';

import type { ChartState } from './types';

/**
 * Shared workspace state.
 *
 * The visible range is the one genuinely global piece of UI state — zooming the
 * chart must re-range every linked panel — so it lives in a store rather than
 * being threaded through props. Everything persists: a reload must not reset
 * the workspace.
 *
 * The range is a full ISO instant, not a date. Scalping lives inside a single
 * day, so minute granularity is the common case, not the exception.
 */

const KEY = 'poc.chart.v3';

const DEFAULTS: ChartState = {
  symbol: 'XBTUSD',
  bin: AUTO,
  candleType: 'regular',
  from: '2019-06-09T00:00:00.000Z',
  to: '2019-06-09T08:00:00.000Z',
  featured: null,
  bottom: [],
  overlays: [],
  featuredCollapsed: false,
  bottomCollapsed: false,
  favorites: [],
  logScale: true,
};

let state: ChartState = load();

const listeners = new Set<() => void>();

export function useChartState(): ChartState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Star or unstar an indicator. Favourites are workspace state like any other. */
export function toggleFavorite(id: string): void {
  const favorites = state.favorites.includes(id)
    ? state.favorites.filter((f) => f !== id)
    : [...state.favorites, id];

  setChartState({ favorites });
}

export function setChartState(patch: Partial<ChartState>): void {
  state = { ...state, ...patch };

  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** Merged over defaults so a stored state from an older shape still loads. */
function load(): ChartState {
  try {
    const raw = localStorage.getItem(KEY);

    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}
