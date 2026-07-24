import { useEffect, useRef, useState } from 'react';

import { fetchCandles, fetchIndicators, fetchSeries } from './api';
import { covers, nearEdge, padded, slice } from './window';

import type { ApiCandle, ApiIndicator, ApiPoint } from '@poc/core';
import type { Windowed } from './types';

/**
 * Data loading, kept out of the components.
 *
 * The viewport moves now and data catches up. A range change is answered from
 * the loaded buffer when it can be — which is always, when zooming in, since a
 * narrower range is a strict subset of what is already held. Only a range that
 * escapes the buffer, or a change of symbol/bin/series, costs a request.
 *
 * Nothing here ever blanks: while a fetch is in flight the previous rows stay
 * on screen, and each series updates independently as its own data lands.
 */

/** A drag emits many range updates; only the settled one should reach the API. */
const DEBOUNCE_MS = 120;

export function useIndicators(symbol: string): ApiIndicator[] {
  const [indicators, setIndicators] = useState<ApiIndicator[]>([]);

  useEffect(() => {
    fetchIndicators(symbol)
      .then(setIndicators)
      .catch(() => setIndicators([]));
  }, [symbol]);

  return indicators;
}

export function useCandles(symbol: string, from: string, to: string, bin: string): ApiCandle[] {
  return useWindowed<ApiCandle>(
    `${symbol}|${bin}|candles`,
    from,
    to,
    (lo, hi, signal) => fetchCandles(symbol, lo, hi, bin, signal),
    (row) => row.t,
  );
}

/** Series for a set of ids, keyed by id. Each loads and updates on its own. */
export function useSeriesMap(
  ids: string[],
  symbol: string,
  from: string,
  to: string,
  bin: string,
): Record<string, ApiPoint[]> {
  const [map, setMap] = useState<Record<string, ApiPoint[]>>({});
  const windows = useRef(new Map<string, Windowed<ApiPoint>>());
  const inflight = useRef(new Map<string, AbortController>());
  const key = ids.join(',');

  useEffect(() => {
    const lo = Date.parse(from);
    const hi = Date.parse(to);

    /** Answer from the buffer first, so the panes redraw before any request. */
    const immediate: Record<string, ApiPoint[]> = {};
    const wanted: string[] = [];

    for (const id of ids) {
      const seriesKey = `${symbol}|${bin}|${id}`;
      const win = windows.current.get(id) ?? null;

      if (covers(win, seriesKey, lo, hi)) {
        immediate[id] = slice(win as Windowed<ApiPoint>, lo, hi);

        if (! nearEdge(win, seriesKey, lo, hi)) {
          continue;
        }
      }

      wanted.push(id);
    }

    setMap((prev) => {
      const next: Record<string, ApiPoint[]> = {};

      /** Keep the previous rows for anything still loading — never blank a pane. */
      for (const id of ids) {
        next[id] = immediate[id] ?? prev[id] ?? [];
      }

      return next;
    });

    if (wanted.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      const range = padded(lo, hi);
      const isoFrom = new Date(range.from).toISOString();
      const isoTo = new Date(range.to).toISOString();

      for (const id of wanted) {
        const seriesKey = `${symbol}|${bin}|${id}`;

        inflight.current.get(id)?.abort();

        const controller = new AbortController();

        inflight.current.set(id, controller);

        fetchSeries(id, symbol, isoFrom, isoTo, bin, controller.signal)
          .then((rows) => {
            windows.current.set(id, {
              key: seriesKey,
              from: range.from,
              to: range.to,
              rows,
              stamps: rows.map((r) => Date.parse(r.t)),
            });

            setMap((prev) => ({ ...prev, [id]: slice(windows.current.get(id)!, lo, hi) }));
          })
          .catch(() => undefined);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    /** `key` stands in for `ids`: the array identity changes every render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, symbol, from, to, bin]);

  return map;
}

/**
 * One buffered series. Serves the visible range from the loaded window when it
 * can, fetches a padded range when it cannot, and keeps the last rows visible
 * throughout.
 */
function useWindowed<T>(
  key: string,
  from: string,
  to: string,
  load: (from: string, to: string, signal: AbortSignal) => Promise<T[]>,
  stampOf: (row: T) => string,
): T[] {
  const [rows, setRows] = useState<T[]>([]);
  const win = useRef<Windowed<T> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    const lo = Date.parse(from);
    const hi = Date.parse(to);
    const cached = covers(win.current, key, lo, hi);

    if (cached) {
      setRows(slice(win.current as Windowed<T>, lo, hi));

      if (! nearEdge(win.current, key, lo, hi)) {
        return;
      }
    }

    const timer = setTimeout(() => {
      const range = padded(lo, hi);

      inflight.current?.abort();

      const controller = new AbortController();

      inflight.current = controller;

      load(new Date(range.from).toISOString(), new Date(range.to).toISOString(), controller.signal)
        .then((loaded) => {
          win.current = {
            key,
            from: range.from,
            to: range.to,
            rows: loaded,
            stamps: loaded.map((r) => Date.parse(stampOf(r))),
          };

          setRows(slice(win.current, lo, hi));
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from, to]);

  return rows;
}
