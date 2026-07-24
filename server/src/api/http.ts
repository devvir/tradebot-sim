import { createServer } from 'http';

import { listSymbols, listTables, loadConfig, openDataset } from '@poc/data';

import { binSizes, candles, indicatorSeries, listIndicators } from './series';

/**
 * The UI's data server. Single user, read-only, localhost.
 *
 * Every route is discovery or a cached read. Nothing here generates data — a
 * request for an uncached series is an error, not a trigger to compute it.
 */
export async function serveApi(port: number): Promise<void> {
  const config = loadConfig();
  const { conn } = await openDataset(config);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const q = url.searchParams;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    try {
      const body = await route(url.pathname, q);

      if (body === undefined) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));

        return;
      }

      res.end(JSON.stringify(body));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  async function route(path: string, q: URLSearchParams): Promise<unknown> {
    const symbol = q.get('symbol') ?? 'XBTUSD';
    const from = q.get('from') ?? '2015-01-01';
    const to = q.get('to') ?? '2027-01-01';
    const bin = q.get('bin') ?? '1D';

    if (path === '/api/symbols') {
      return listSymbols(config);
    }

    if (path === '/api/tables') {
      return listTables(config, symbol);
    }

    if (path === '/api/bins') {
      return binSizes();
    }

    if (path === '/api/indicators') {
      return listIndicators(config, symbol);
    }

    if (path === '/api/candles') {
      return candles(conn, config, symbol, from, to, bin);
    }

    if (path.startsWith('/api/indicator/')) {
      const id = decodeURIComponent(path.slice('/api/indicator/'.length));

      return indicatorSeries(conn, config, symbol, id, from, to, bin);
    }

    return undefined;
  }

  await new Promise<void>((resolve) => server.listen(port, resolve));

  console.log(`api on http://localhost:${port}`);
}
