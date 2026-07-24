import { createReadStream } from 'fs';
import { createServer } from 'http';
import { createInterface } from 'readline';

import { streamBins } from '@poc/data';
import { zonesViewerPage } from './viewer';

import type { PocConfig } from '@poc/core';

/**
 * Local zone-viewer server: loads the whole period once into compact
 * numeric arrays (a few hundred MB for 8+ years of 1m data), then serves
 * the viewer page and on-demand aggregated slices — full period at 1-day
 * buckets down to single minutes, fetched as the viewport moves. PoC only:
 * single-user, read-only, localhost.
 */
export async function serveZones(
  config: PocConfig,
  symbol: string,
  from: string,
  to: string,
  bandsPath: string,
  port: number,
  interval = '1m',
): Promise<void> {
  console.log('loading bins…');

  const ts: number[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];

  for await (const bin of streamBins(config, symbol, from, to, interval)) {
    ts.push(Date.parse(bin.t));
    o.push(bin.open);
    h.push(bin.high);
    l.push(bin.low);
    c.push(bin.close);
  }

  console.log(`bins: ${ts.length}. loading bands…`);

  const bts: number[] = [];
  const ib: number[] = [];
  const it: number[] = [];
  const ob: number[] = [];
  const ot: number[] = [];
  const gate: number[] = [];
  const fail: string[] = [];

  {
    const rl = createInterface({ input: createReadStream(bandsPath), crlfDelay: Infinity });

    for await (const line of rl) {
      if (! line) {
        continue;
      }

      const p = JSON.parse(line);

      bts.push(Date.parse(p.t));
      ib.push(p.ib);
      it.push(p.it);
      ob.push(p.ob);
      ot.push(p.ot);
      gate.push(p.g ? 1 : 0);
      fail.push(p.f ?? '');
    }
  }

  console.log(`bands: ${bts.length} (${bts.length ? new Date(bts[0]).toISOString() + ' → ' + new Date(bts[bts.length - 1]).toISOString() : 'none'})`);

  const lowerBound = (arr: number[], v: number) => {
    let lo = 0;
    let hi = arr.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (arr[mid] < v) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(zonesViewerPage(`${symbol} zones ${from} → ${to}`, ts[0], ts[ts.length - 1]));

      return;
    }

    if (url.pathname === '/slice') {
      const a = Math.max(ts[0], Number(url.searchParams.get('from')));
      const b = Math.min(ts[ts.length - 1], Number(url.searchParams.get('to')));
      const n = Math.min(500, Math.max(50, Number(url.searchParams.get('n') || 240)));
      const i0 = lowerBound(ts, a);
      const i1 = Math.max(i0 + 1, lowerBound(ts, b));
      const bucket = Math.max(1, Math.ceil((i1 - i0) / n));
      const out: (number | string)[][] = [];

      for (let s = i0; s < i1; s += bucket) {
        const e = Math.min(i1, s + bucket);

        let hh = -Infinity;
        let ll = Infinity;

        for (let i = s; i < e; i++) {
          if (h[i] > hh) {
            hh = h[i];
          }

          if (l[i] < ll) {
            ll = l[i];
          }
        }

        /** Timestamp alignment — robust to any coverage mismatch between files. */
        const bi = lowerBound(bts, ts[s]);
        const hasBands = bi < bts.length && bts[bi] === ts[s];

        out.push([
          ts[s], o[s], hh, ll, c[e - 1],
          hasBands ? ib[bi] : 0, hasBands ? it[bi] : 0,
          hasBands ? ob[bi] : 0, hasBands ? ot[bi] : 0,
          hasBands ? gate[bi] : -1,
          hasBands ? fail[bi] : '',
        ]);
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));

      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`zones viewer: http://127.0.0.1:${port}/`);
  });
}
