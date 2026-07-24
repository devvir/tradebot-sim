import type { ApiCandle, ApiIndicator, ApiPoint } from '@poc/core';

/** Thin fetch layer. The API is read-only, so every call is a GET with query params. */

export async function fetchSymbols(): Promise<string[]> {
  return get('/api/symbols');
}

export async function fetchBins(): Promise<string[]> {
  return get('/api/bins');
}

export async function fetchIndicators(symbol: string): Promise<ApiIndicator[]> {
  return get(`/api/indicators?symbol=${encodeURIComponent(symbol)}`);
}

export async function fetchCandles(
  symbol: string,
  from: string,
  to: string,
  bin: string,
  signal?: AbortSignal,
): Promise<ApiCandle[]> {
  return get(`/api/candles?${params({ symbol, from, to, bin })}`, signal);
}

export async function fetchSeries(
  id: string,
  symbol: string,
  from: string,
  to: string,
  bin: string,
  signal?: AbortSignal,
): Promise<ApiPoint[]> {
  return get(`/api/indicator/${encodeURIComponent(id)}?${params({ symbol, from, to, bin })}`, signal);
}

function params(o: Record<string, string>): string {
  return new URLSearchParams(o).toString();
}

/** Superseded requests are aborted, not merely ignored on arrival. */
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  const body = await res.json();

  if (! res.ok) {
    throw new Error(body?.error ?? res.statusText);
  }

  return body as T;
}
