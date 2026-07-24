import { createReadStream } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

import { runSim, symbolDir } from '@poc/core';

import type { BatchMonth, BatchOptions, Bin1m, PocConfig, SimParams } from '@poc/core';

/**
 * Monthly-restart batch: every month starts from scratch — a fresh wallet
 * (initialUsd converted to XBT at the month's first price), no positions,
 * bands warming up on the month's first hours. No recovery: the first
 * freeze/bust ends the month's trading and the account coasts to month end.
 *
 * Streams the bins file once, buffering one month at a time.
 */
export async function runBatch(
  config: PocConfig,
  params: SimParams,
  opts: BatchOptions,
): Promise<BatchMonth[]> {
  const path = join(symbolDir(config, opts.symbol), 'bins1m.ndjson');
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const months: BatchMonth[] = [];

  let currentMonth = '';
  let buffer: Bin1m[] = [];

  const flush = () => {
    if (currentMonth >= opts.fromMonth && currentMonth <= opts.toMonth && buffer.length > 1000) {
      months.push(simMonth(currentMonth, buffer, params, opts.initialBtc));
    }

    buffer = [];
  };

  for await (const line of rl) {
    if (! line) {
      continue;
    }

    const month = line.slice(6, 13);

    if (month > opts.toMonth) {
      break;
    }

    if (month !== currentMonth) {
      flush();
      currentMonth = month;
    }

    if (month >= opts.fromMonth) {
      buffer.push(JSON.parse(line) as Bin1m);
    }
  }

  flush();

  return months;
}

function simMonth(month: string, bins: Bin1m[], base: SimParams, initialBtc: number): BatchMonth {
  const params: SimParams = { ...base, initialWallet: initialBtc };
  const result = runSim(bins, params);

  /** Native-unit series: hourly equity in mBTC. No USD anywhere. */
  const mbtc = result.rows.map((r) => 1000 * ((r.equityMin + r.equityMax) / 2));

  const s = result.finalSnapshot;
  const finalXbtPct = s.equity / initialBtc;

  return {
    month,
    hours: result.rows.length,
    equityMBtcSeries: mbtc,
    finalMBtc: 1000 * s.equity,
    finalXbtPct,
    minMBtc: Math.min(...mbtc),
    maxMBtc: Math.max(...mbtc),
    frozeAt: result.frozeAt,
    bustedAt: result.bustedAt,
    gapAtFreeze: result.gapAtFreeze,
    frozenUPnl: result.frozenUPnl,
    fees: s.feesPaid,
    realized: s.realized,
    events: result.events.length,
  };
}
