import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';

import { DuckDBInstance } from '@duckdb/node-api';
import { BIN_LADDER, INDICATORS, symbolDir } from '@poc/core';

import { listSymbols, loadBars, maxTimestamp, minTimestamp, tableGlob } from '../dataset/read';

import type { DuckDBConnection } from '@duckdb/node-api';
import type { Bin1m, PocConfig } from '@poc/core';

/**
 * Warmup overlap: how far back before a cached end to recompute so an
 * indicator's running state (EMA, Wilder RSI, …) is exact at the join. 30
 * days ≫ the deepest lookback (200-period EMA on 15m converges in ~2 days),
 * and it's cheap to reload. Every registered indicator is causal and either
 * windowed or fast-converging, so the overlap recompute is exact — there are
 * no cumulative-from-origin indicators.
 */
const OVERLAP_DAYS = 30;

/**
 * Run the indicator cache for every symbol that has bins.
 *
 * Indicator cost scales with bin count, not volume — XBTUSD is only 9% of the
 * 55.7 M cached minutes — so "every symbol" is roughly 11× one symbol. It is
 * still worth doing wholesale: the long tail is nearly free (excluding 518
 * thin symbols would save ~0.4 GB of ~20 GB), and a partial cache means the UI
 * silently offers different indicators per symbol.
 *
 * Resumable for free: a symbol already up to date exits before loading its
 * bins, so re-running after an interrupt costs a directory scan per symbol.
 */
export async function precomputeAllSymbols(
  config: PocConfig,
  opts: { only?: string[]; force?: boolean },
): Promise<void> {
  const symbols = listSymbols(config).filter((s) => tableGlob(config, s, 'tradeBin1m'));

  console.log(`${symbols.length} symbols with bins`);

  let done = 0;

  for (const symbol of symbols) {
    done++;
    console.log(`\n[${done}/${symbols.length}] ${symbol}`);

    try {
      await precomputeIndicators(config, symbol, opts);
    } catch (error) {
      /** One bad symbol must not end a run of hundreds. */
      console.log(`${symbol}: FAILED — ${(error as Error).message}`);
    }
  }

  console.log(`\nall symbols done (${symbols.length})`);
}

/**
 * Compute registered indicators over the full history, caching each to its own
 * Parquet file (indicators/<id>.parquet, [t, v]).
 *
 * Incremental by design: indicators never look ahead, so extending the data
 * only appends the missing tail. Uncached (newly-added) indicators compute in
 * full; already-cached ones load only from their cached end minus the warmup
 * overlap and append rows after it. `--force` recomputes from scratch.
 */
export async function precomputeIndicators(
  config: PocConfig,
  symbol: string,
  opts: { only?: string[]; force?: boolean },
): Promise<void> {
  const outDir = join(symbolDir(config, symbol), 'indicators');

  mkdirSync(outDir, { recursive: true });

  /** Only cached indicators are precomputed; `cached: false` are derived on read. */
  const wanted = INDICATORS.filter((s) => s.cached && (! opts.only || opts.only.includes(s.id)));
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();

  await conn.run(`SET threads=2`);
  await conn.run(`SET memory_limit='2GB'`);

  /** Per-indicator cached end (null = uncached → full compute). */
  const cachedEnd = new Map<string, string | null>();

  for (const spec of wanted) {
    const path = join(outDir, `${spec.id}.parquet`);

    cachedEnd.set(spec.id, opts.force || ! existsSync(path) ? null : await maxT(conn, path));
  }

  /**
   * Group by timeframe: each tf's bars are loaded once (from the nearest cached
   * base, so a 1W group reads daily bars and a 1s group reads 1s bars — never
   * the whole minute history for a coarse series), then every indicator on that
   * tf computes over the shared array. Per-process scratch name so concurrent
   * runs can't clobber each other's tail.
   */
  const tail = join(outDir, `_tail.${process.pid}.ndjson`);
  const byTf = new Map<string, typeof wanted>();

  for (const spec of wanted) {
    (byTf.get(spec.tf) ?? byTf.set(spec.tf, []).get(spec.tf)!).push(spec);
  }

  for (const [tf, specs] of byTf) {
    const source = BIN_LADDER[tf]?.source;
    const sourceEnd = source ? await maxTimestamp(conn, config, symbol, source) : null;
    const anyFull = specs.some((s) => cachedEnd.get(s.id) == null);
    const anyBehind = specs.some((s) => {
      const e = cachedEnd.get(s.id);

      return e != null && sourceEnd != null && e < sourceEnd;
    });

    /** Skip the (potentially large) bar load entirely if this tf is current. */
    if (! anyFull && ! anyBehind) {
      continue;
    }

    const ends = specs.map((s) => cachedEnd.get(s.id)).filter((e): e is string => e != null);
    /** undefined = from the beginning; a full compute has no lower bound. */
    const from = anyFull || ends.length === 0 ? undefined : isoMinusDays(minString(ends), OVERLAP_DAYS);

    /**
     * Sub-minute timeframes (source is the 1s floor) can be hundreds of millions
     * of bars — too many to hold as one array. Process them in monthly windows
     * with a warmup prefix so recursive state (EMA…) is exact at each seam, and
     * accumulate each series' rows to its own tail for a single sorted merge.
     * Coarser tfs (≤ 5.7 M bars) load in one pass.
     */
    if (source === 'tradeBin1s') {
      const startIso = from ?? (await minTimestamp(conn, config, symbol, source));

      if (! startIso || ! sourceEnd) {
        continue;
      }

      const windows = monthWindows(startIso, sourceEnd);
      const specTail = new Map(specs.map((s) => [s.id, `${tail}.${s.id}`]));

      for (let wi = 0; wi < windows.length; wi++) {
        const w = windows[wi];
        const bars = await loadBars(conn, config, symbol, tf, w.loadFrom, w.to);

        console.log(`  ${tf} [${w.to.slice(0, 7)}]: ${bars.length} bars`);

        for (const spec of specs) {
          /** First window emits from the cached end (null = full); later windows
           *  skip their warmup prefix by emitting only past the month boundary. */
          const end = wi === 0 ? cachedEnd.get(spec.id) ?? null : w.emitAfter;
          const values = spec.compute(bars);

          await streamTail(specTail.get(spec.id)!, bars, values, end, wi > 0);
        }
      }

      for (const spec of specs) {
        const path = join(outDir, `${spec.id}.parquet`);
        const t = specTail.get(spec.id)!;

        await merge(conn, t, path, cachedEnd.get(spec.id) != null);
        console.log(`  ${spec.id}: merged (${cachedEnd.get(spec.id) == null ? 'full' : 'tail'})`);
      }

      continue;
    }

    const bars = await loadBars(conn, config, symbol, tf, from, undefined);

    console.log(`  ${tf}: ${bars.length} bars from ${from ?? 'start'} (${specs.length} indicators)`);

    for (const spec of specs) {
      const path = join(outDir, `${spec.id}.parquet`);
      const end = cachedEnd.get(spec.id) ?? null;
      const values = spec.compute(bars);
      const n = await streamTail(tail, bars, values, end);

      if (n === 0) {
        continue;
      }

      await merge(conn, tail, path, end !== null);
      console.log(`  ${spec.id}: +${n} rows${end === null ? ' (full)' : ` (from ${end})`}`);
    }
  }

  conn.closeSync();
  console.log('done');
}

/** Max `t` in a cached parquet, or null if empty/missing. */
async function maxT(conn: DuckDBConnection, path: string): Promise<string | null> {
  if (! existsSync(path)) {
    return null;
  }

  const reader = await conn.runAndReadAll(
    `SELECT strftime(max(t), '%Y-%m-%dT%H:%M:%S.000Z') AS m FROM read_parquet('${path}')`,
  );
  const rows = reader.getRowObjects();

  return rows.length > 0 && rows[0].m != null ? String(rows[0].m) : null;
}

/** Write rows with t > end to `tmpPath`; resolves the count once flushed. */
/**
 * Write rows with t > end, emitting only where the value CHANGES.
 *
 * A cached series is a step function: a row means "the value became this at
 * this timestamp and holds until the next row". Consumers forward-fill.
 *
 * Without this every series is stored on the 1-minute grid regardless of its
 * own timeframe, so a 5m indicator repeats each value 5 times and a monthly one
 * ~43,200 times — 38,000 rows to carry one number. The redundancy then has to
 * be undone somewhere: it was being sent over the wire in full (measured 2.4 MB
 * where 480 KB suffices for one month of a 5m series) and collapsed in the
 * browser renderer. Dropping it at the source removes it from every consumer.
 */
async function streamTail(
  tmpPath: string,
  bins: Bin1m[],
  values: (number | null)[],
  end: string | null,
  append = false,
): Promise<number> {
  const ws = createWriteStream(tmpPath, append ? { flags: 'a' } : undefined);

  let count = 0;
  let previous: number | null | undefined;

  for (let i = 0; i < bins.length; i++) {
    if (end !== null && bins[i].t <= end) {
      /** Track the carried value across the skipped prefix, or the first
       *  appended row would look like a change when it is not. */
      previous = normalize(values[i]);
      continue;
    }

    const v = normalize(values[i]);

    if (previous !== undefined && v === previous) {
      continue;
    }

    previous = v;

    if (! ws.write(`{"t":"${bins[i].t}","v":${v === null ? 'null' : v}}\n`)) {
      await new Promise((res) => ws.once('drain', res));
    }

    count++;
  }

  await new Promise<void>((res, rej) => {
    ws.on('error', rej);
    ws.end(() => res());
  });

  return count;
}

/** Merge the tail NDJSON into the parquet: append when extending, else replace. */
async function merge(conn: DuckDBConnection, tail: string, path: string, append: boolean): Promise<void> {
  const tmp = `${path}.tmp`;
  /**
   * `t` is stored as a TIMESTAMP, not text. Storing ISO strings makes every
   * range filter a full string scan — Parquet cannot prune on it — which is why
   * reading these caches used to cost seconds per file.
   */
  const tailRead = `(SELECT CAST(t AS TIMESTAMP) AS t, v FROM read_json('${tail}',
    columns = {'t': 'VARCHAR', 'v': 'DOUBLE'}, format = 'newline_delimited'))`;
  const source = append
    ? `SELECT * FROM read_parquet('${path}') UNION ALL SELECT * FROM ${tailRead}`
    : `SELECT * FROM ${tailRead}`;

  await conn.run(`COPY (${source} ORDER BY t) TO '${tmp}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`);
  renameSync(tmp, path);
  unlinkSync(tail);
}

/** Non-finite values are stored as null, so they compare equal when deduping. */
function normalize(v: number | null): number | null {
  return v === null || ! Number.isFinite(v) ? null : v;
}

/** ISO timestamp `days` before `iso` (UTC). */
function isoMinusDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() - days * 86400000).toISOString();
}

/** Lexicographic min of ISO timestamp strings (ISO order = chronological). */
function minString(arr: string[]): string {
  return arr.reduce((a, b) => (a < b ? a : b));
}

/** Warmup prefix for a windowed sub-minute compute — days before each month's
 *  start to reload so recursive state (EMA…) is exact at the seam. 2 days ≫ the
 *  convergence of a 200-period EMA even at 1s (~17 min). */
const FINE_WARMUP_DAYS = 2;

/**
 * Split [start, end] into calendar-month windows for chunked sub-minute compute.
 * Each window loads from `loadFrom` (a warmup prefix before the month, except
 * the first which starts at `start`) and emits only rows past `emitAfter` (the
 * instant before the month, so the warmup prefix seeds state without being
 * re-emitted). `emitAfter` is null for the first window (its lower bound is the
 * caller's cached end).
 */
function monthWindows(start: string, end: string): { loadFrom: string; emitAfter: string | null; to: string }[] {
  const out: { loadFrom: string; emitAfter: string | null; to: string }[] = [];
  const endMs = new Date(end).getTime();
  const first = new Date(start);

  let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  let isFirst = true;

  while (cursor <= endMs) {
    const monthStart = new Date(cursor).toISOString();
    const next = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + 1, 1);

    out.push({
      loadFrom: isFirst ? start : isoMinusDays(monthStart, FINE_WARMUP_DAYS),
      emitAfter: isFirst ? null : new Date(cursor - 1).toISOString(),
      to: new Date(next).toISOString(),
    });

    cursor = next;
    isFirst = false;
  }

  return out;
}
