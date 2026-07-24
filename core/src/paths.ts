import type { PocConfig } from './types';

/**
 * Per-symbol path layout. Symbols are bucketed by first character under
 * `symbols/<L>/` so the data root is navigable by hand instead of 850+ flat
 * entries (see docs/planning/BINS.md and the ROADMAP folder-structure note).
 *
 * Every per-symbol path in the codebase must go through `symbolDir` — it is the
 * single place the layout is defined, so the next layout change touches one
 * function, not thirty call sites.
 *
 * Kept free of node's `path` module on purpose: core is browser-safe (the web
 * bundle imports the registry), and these are plain POSIX string joins.
 */

/** Bucket a symbol to its first-letter directory; digits pool as `0-9`. */
export function symbolBucket(symbol: string): string {
  const c = symbol[0].toUpperCase();

  return c >= '0' && c <= '9' ? '0-9' : c;
}

/** Absolute directory for a symbol's data: `<pocDir>/symbols/<bucket>/<symbol>`. */
export function symbolDir(config: PocConfig, symbol: string): string {
  return `${config.pocDir}/symbols/${symbolBucket(symbol)}/${symbol}`;
}

/** Root under which all symbol directories live. */
export function symbolsRoot(config: PocConfig): string {
  return `${config.pocDir}/symbols`;
}
