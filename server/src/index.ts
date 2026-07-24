import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';

import { Command } from 'commander';

import { symbolDir } from '@poc/core';
import { bandOptions, bandParamsFrom, loadConfig } from '@poc/data';

import { serveZones } from './serve/server';

/**
 * Server layer entry point. Serves data and the UI; it never builds the
 * dataset — generation lives in @poc/data behind its own CLI.
 */
const program = new Command();

program.name('poc-server').description('PoC data/UI server');

program
  .command('api', { isDefault: true })
  .description('Serve the dataset to the UI (discovery + cached series)')
  .option('--port <port>', 'listen port', '8788')
  .action(async (o) => {
    const { serveApi } = await import('./api/http');

    await serveApi(parseInt(o.port, 10));
  });

bandOptions(
  program
    .command('zones')
    .description('Whole-period zone viewer (loads bins + precomputed bands, aggregates on demand)')
    .requiredOption('-s, --symbol <symbol>')
    .requiredOption('--from <iso>')
    .requiredOption('--to <iso>')
    .option('--interval <i>', 'bin interval: 1m or 5m', '1m')
    .option('--port <port>', 'listen port', '8787'),
).action(async (o) => {
  const config = loadConfig();
  const params = bandParamsFrom(o);
  const hash = createHash('sha1')
    .update(JSON.stringify({ ...params, binMinutes: parseInt(o.interval, 10) }))
    .digest('hex')
    .slice(0, 8);
  const bandsPath = join(symbolDir(config, o.symbol), `bands.${o.from}_${o.to}.${hash}.ndjson`);

  if (! existsSync(bandsPath)) {
    throw new Error(
      `band series missing for these params — run: poc bands -s ${o.symbol} --from ${o.from} --to ${o.to} (hash ${hash})`,
    );
  }

  await serveZones(config, o.symbol, o.from, o.to, bandsPath, parseInt(o.port, 10), o.interval);
});

program.parseAsync(process.argv);
