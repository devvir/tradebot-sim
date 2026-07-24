/** All web-layer types live here (project rule: types in types.ts, no exceptions). */

import type { ApiIndicator } from '@poc/core';

export type CandleType = 'regular' | 'heikin-ashi';

/** Everything that must survive a refresh. */
export interface ChartState {
  symbol: string;
  bin: string;
  candleType: CandleType;
  /** Visible range, ISO dates. Shared: zooming the chart re-ranges every panel. */
  from: string;
  to: string;
  /** Featured (top) pane — single select, null when empty. */
  featured: string | null;
  /** Common (bottom) panes — multi select. */
  bottom: string[];
  /** Indicators drawn on the candle chart itself. */
  overlays: string[];
  featuredCollapsed: boolean;
  bottomCollapsed: boolean;
  /** Starred indicators — the default filter in every selector. */
  favorites: string[];
  /** Logarithmic price axis. On by default: price moves are proportional. */
  logScale: boolean;
}

/**
 * A loaded span of a series, wider than the viewport, that answers any request
 * falling inside it without a fetch.
 */
export interface Windowed<T> {
  /** Identity of what was loaded — symbol, bin and series. A change invalidates it. */
  key: string;
  /** Loaded bounds, epoch ms. */
  from: number;
  to: number;
  rows: T[];
  /** Parsed timestamps, index-aligned with `rows`, so slicing never re-parses. */
  stamps: number[];
}

/** The selector varies on two independent axes; nothing else differs between its uses. */
export interface SelectorProps {
  indicators: ApiIndicator[];
  /** overlayable (pane === 'price') or not. */
  overlay: boolean;
  multi: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
}

/** Which slice of the catalogue a selector is showing. */
export type SelectorTab = 'favorites' | 'all';
