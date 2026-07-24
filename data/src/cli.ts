import { createHash } from 'crypto';
import { copyFileSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from 'commander';

import { bandOptions, bandParamsFrom } from './bands/options';
import { writeBandSeries } from './bands/series';
import { loadConfig } from './config';
import { loadBins, streamBins } from './data';
import { extractBins } from './extract/bins';
import { extractWindow } from './extract/vault';
import { extractRanges, summarize, writeRanges } from './ranges/extract';
import { renderBatchChart } from './chart/batch-html';
import { renderChart } from './chart/html';
import { renderZonesChart } from './chart/zones-html';
import { runBatch } from './sim/batch';
import { runSim, symbolDir } from '@poc/core';

import type { RangeParams, SimParams } from '@poc/core';

const program = new Command();

program.name('poc').description('Range-scalper PoC experiments (docs/planning/range-scalper/POC.md)');

program
  .command('extract-bins')
  .description('Pull tradeBin<interval> for a symbol from MongoDB into NDJSON')
  .requiredOption('-s, --symbol <symbol>')
  .option('--from <iso>')
  .option('--to <iso>')
  .option('--interval <i>', 'bin interval: 1m or 5m', '1m')
  .action(async (o) => {
    await extractBins(loadConfig(), { symbol: o.symbol, from: o.from, to: o.to, interval: o.interval });
  });

program
  .command('extract-window')
  .description('Copy vault daily buckets to the poc raw dir and extract one symbol into CSV')
  .requiredOption('-t, --table <table>', 'vault table (quote, trade, ...)')
  .requiredOption('-s, --symbol <symbol>')
  .requiredOption('--from <yyyy-mm-dd>')
  .requiredOption('--to <yyyy-mm-dd>', 'inclusive')
  .action(async (o) => {
    await extractWindow(loadConfig(), { table: o.table, symbol: o.symbol, from: o.from, to: o.to });
  });

program
  .command('ranges')
  .description('Extract candidate ranges from previously extracted 1m bins')
  .requiredOption('-s, --symbol <symbol>')
  .requiredOption('--from <iso>')
  .requiredOption('--to <iso>')
  .option('--window <min>', 'formation window, minutes', '60')
  .option('--amplitude <frac>', 'max relative band amplitude', '0.008')
  .option('--exit-confirm <min>', 'minutes outside to confirm death', '3')
  .option('--min-duration <min>', 'minimum range duration', '60')
  .option('--touch-zone <frac>', 'edge fraction counting as touch', '0.1')
  .action(async (o) => {
    const params: RangeParams = {
      window: parseInt(o.window, 10),
      amplitude: parseFloat(o.amplitude),
      exitConfirm: parseInt(o.exitConfirm, 10),
      minDuration: parseInt(o.minDuration, 10),
      touchZone: parseFloat(o.touchZone),
    };

    const config = loadConfig();
    const opts = { symbol: o.symbol, from: o.from, to: o.to, params };
    const ranges = await extractRanges(config, opts);
    const outPath = writeRanges(config, opts, ranges);

    console.log(summarize(ranges));
    console.log(`-> ${outPath}`);
  });

program
  .command('sim')
  .description('Run the naive v1 simulator (no recovery: stops at first freeze) over extracted bins')
  .requiredOption('-s, --symbol <symbol>')
  .requiredOption('--from <iso>')
  .requiredOption('--to <iso>')
  .option('--wallet <xbt>', 'initial wallet, XBT', '1')
  .option('--max-lev <x>', 'max gross leverage per side', '0.5')
  .option('--base-lev <x>', 'carried-for-gain leverage per side (= step)', '0.05')
  .option('--band-refresh <min>', 'recompute bands every N minutes', '1')
  .option('--outer-occ <frac>', 'outer band occupancy (1 = strict min/max)', '0.98')
  .option('--exit-margin <frac>', 'freeze only beyond outer band by this margin', '0')
  .option('--exit-confirm <min>', 'consecutive minutes beyond to confirm storm', '1')
  .action(async (o) => {
    const params: SimParams = {
      bands: {
        innerWindow: 360,
        innerOccupancy: 0.8,
        outerWindow: 360,
        outerOccupancy: parseFloat(o.outerOcc),
        outerLeniency: 1.1,
        maxInnerWidth: 0.02,
        outerCap: 0.03,
        mergeLookback: 30,
        mergeWeightNow: 1,
        mergeWeightPast: 1,
        jumpLookback: 60,
        expansionLookback: 240,
        expansionMax: 1.5,
        crossCooldown: 72,
        outerMinRatio: 1.5,
      },
      account: { takerFee: 0.0005, initMargin: 0.01 },
      initialWallet: parseFloat(o.wallet),
      maxLeverage: parseFloat(o.maxLev),
      baseLeverage: parseFloat(o.baseLev),
      ladderSpan: 0.002,
      deriskKeep: 0.5,
      collectStart: 0.002,
      collectSpacing: 0.001,
      reEntry: 0.001,
      breakevenBuffer: 0.001,
      bustThreshold: 0.2,
      bandRefreshMin: parseInt(o.bandRefresh, 10),
      exitMargin: parseFloat(o.exitMargin),
      exitConfirm: parseInt(o.exitConfirm, 10),
    };

    const config = loadConfig();
    const bins = await loadBins(config, o.symbol, o.from, o.to);

    if (bins.length === 0) {
      throw new Error('no bins in period — run extract-bins first');
    }

    const result = runSim(bins, params);
    const base = join(symbolDir(config, o.symbol), `sim.${o.from}_${o.to}`);
    const header =
      'hour,priceMin,priceMax,walletMin,walletMax,equityMin,equityMax,uPnlMin,uPnlMax,availMin,availMax,gapMin,gapMax,realized,feesPaid,trades,mode';
    const csv = result.rows
      .map((r) =>
        [
          r.hour, r.priceMin, r.priceMax, r.walletMin, r.walletMax, r.equityMin, r.equityMax,
          r.uPnlMin, r.uPnlMax, r.availMin, r.availMax,
          Number.isNaN(r.gapMin) ? '' : r.gapMin, Number.isNaN(r.gapMax) ? '' : r.gapMax,
          r.realized, r.feesPaid, r.trades, r.mode,
        ].join(','),
      )
      .join('\n');

    writeFileSync(`${base}.hourly.csv`, header + '\n' + csv + '\n');
    writeFileSync(`${base}.events.ndjson`, result.events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const s = result.finalSnapshot;

    console.log(`bins: ${bins.length}  events: ${result.events.length}  hours logged: ${result.rows.length}`);
    console.log(`froze: ${result.frozeAt ?? 'never'}  busted: ${result.bustedAt ?? 'never'}`);
    console.log(
      `final: wallet=${s.wallet.toFixed(6)} equity=${s.equity.toFixed(6)} uPnl=${s.uPnl.toFixed(6)} ` +
        `realized=${s.realized.toFixed(6)} fees=${s.feesPaid.toFixed(6)} XBT`,
    );
    console.log(`-> ${base}.hourly.csv`);
    console.log(`-> ${base}.events.ndjson`);
  });

program
  .command('chart')
  .description('Render a sim hourly CSV into a self-contained HTML chart page')
  .requiredOption('-s, --symbol <symbol>')
  .requiredOption('--from <iso>')
  .requiredOption('--to <iso>')
  .action((o) => {
    const config = loadConfig();
    const base = join(symbolDir(config, o.symbol), `sim.${o.from}_${o.to}`);
    const htmlDir = join(symbolDir(config, o.symbol), 'html');
    mkdirSync(htmlDir, { recursive: true });
    const out = join(htmlDir, `sim.${o.from}_${o.to}.chart.html`);

    renderChart(`${base}.hourly.csv`, out, `${o.symbol} naive v1 — ${o.from} → ${o.to}`);
    console.log(`-> ${out}`);
  });

program
  .command('batch')
  .description('Monthly-restart batch: fresh wallet each month, no recovery; writes summary JSON + overview chart')
  .requiredOption('-s, --symbol <symbol>')
  .requiredOption('--from <yyyy-mm>', 'first month, inclusive')
  .requiredOption('--to <yyyy-mm>', 'last month, inclusive')
  .option('--btc <amount>', 'fresh wallet per month, BTC', '0.1')
  .option('--base-lev <x>', 'carried-for-gain leverage per side (= step)', '0.05')
  .option('--max-lev <x>', 'max gross leverage per side', '0.5')
  .option('--tag <tag>', 'run tag for the archive', '')
  .option('--note <text>', 'run annotation for runs.md', '')
  .option('--band-refresh <min>', 'recompute bands every N minutes', '1')
  .option('--outer-occ <frac>', 'outer band occupancy (1 = strict min/max)', '0.98')
  .option('--exit-margin <frac>', 'freeze only beyond outer band by this margin', '0')
  .option('--exit-confirm <min>', 'consecutive minutes beyond to confirm storm', '1')
  .action(async (o) => {
    const params: SimParams = {
      bands: {
        innerWindow: 360,
        innerOccupancy: 0.8,
        outerWindow: 360,
        outerOccupancy: parseFloat(o.outerOcc),
        outerLeniency: 1.1,
        maxInnerWidth: 0.02,
        outerCap: 0.03,
        mergeLookback: 30,
        mergeWeightNow: 1,
        mergeWeightPast: 1,
        jumpLookback: 60,
        expansionLookback: 240,
        expansionMax: 1.5,
        crossCooldown: 72,
        outerMinRatio: 1.5,
      },
      account: { takerFee: 0.0005, initMargin: 0.01 },
      initialWallet: 1,
      maxLeverage: parseFloat(o.maxLev),
      baseLeverage: parseFloat(o.baseLev),
      ladderSpan: 0.002,
      deriskKeep: 0.5,
      collectStart: 0.002,
      collectSpacing: 0.001,
      reEntry: 0.001,
      breakevenBuffer: 0.001,
      bustThreshold: 0.2,
      bandRefreshMin: parseInt(o.bandRefresh, 10),
      exitMargin: parseFloat(o.exitMargin),
      exitConfirm: parseInt(o.exitConfirm, 10),
    };

    const config = loadConfig();
    const initialBtc = parseFloat(o.btc);
    const months = await runBatch(config, params, {
      symbol: o.symbol,
      fromMonth: o.from,
      toMonth: o.to,
      initialBtc,
    });

    const base = join(symbolDir(config, o.symbol), `batch.${o.from}_${o.to}`);
    const htmlDir = join(symbolDir(config, o.symbol), 'html');

    mkdirSync(htmlDir, { recursive: true });
    writeFileSync(`${base}.json`, JSON.stringify(months, null, 1));

    const chartPath = join(htmlDir, `batch.${o.from}_${o.to}.chart.html`);

    renderBatchChart(months, chartPath, `${o.symbol} naive batch — ${o.from} → ${o.to}`, initialBtc);

    /** Archive: runs/<stamp>_<tag>/ + annotated runs.md — never overwrite history. */
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const tag = o.tag || 'run';
    const runDir = join(symbolDir(config, o.symbol), 'runs', `${stamp}_${tag}`);

    mkdirSync(runDir, { recursive: true });
    copyFileSync(`${base}.json`, join(runDir, 'batch.json'));
    copyFileSync(chartPath, join(runDir, 'chart.html'));
    writeFileSync(join(runDir, 'params.json'), JSON.stringify(params, null, 1));

    const traded = months.filter((m) => m.events > 0);
    const green = months.filter((m) => m.finalXbtPct > 1).length;
    const p = traded.map((m) => m.finalXbtPct - 1).sort((a, b) => a - b);
    const q = (f: number) => (p.length ? (p[Math.floor(f * (p.length - 1))] * 100).toFixed(3) : '—');
    const avgPct = p.length ? ((p.reduce((s, v) => s + v, 0) / p.length) * 100).toFixed(3) : '—';
    const summary =
      `months ${months.length} (traded ${traded.length}, unsizable ${months.length - traded.length}) · green ${green} · ` +
      `median ${q(0.5)}% · avg ${avgPct}% · worst ${q(0)}% · best ${q(1)}%`;

    appendFileSync(
      join(symbolDir(config, o.symbol), 'runs', 'runs.md'),
      `\n## ${stamp} — ${tag}\n\n` +
        (o.note ? `${o.note}\n\n` : '') +
        `- period ${o.from} → ${o.to} · wallet ${initialBtc} BTC · C = ${(parseFloat(o.baseLev) * initialBtc * 1000).toFixed(3)}` +
        ` mBTC/step (baseLev ${o.baseLev}) · M = ${(parseFloat(o.maxLev) * initialBtc * 1000).toFixed(2)} mBTC (maxLev ${o.maxLev})\n` +
        `- engine: lot = round to 100 USD, no minimum (unsizable months excluded from stats)\n` +
        `- ${summary}\n` +
        `- files: runs/${stamp}_${tag}/ (batch.json, chart.html, params.json)\n`,
    );

    /** Stable latest copy + a run-selector index page. */
    copyFileSync(chartPath, join(htmlDir, 'batch.latest.chart.html'));

    const runDirs = readdirSync(join(symbolDir(config, o.symbol), 'runs'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    const options = runDirs.map((d) => `<option value="../runs/${d}/chart.html">${d}</option>`).join('');

    writeFileSync(
      join(htmlDir, 'runs.html'),
      `<!doctype html><html><head><meta charset="utf-8"><title>batch runs</title>
<style>body{margin:0;display:flex;flex-direction:column;height:100vh;font:13px system-ui}
header{padding:8px 12px;background:#16181d;color:#a6adba;display:flex;gap:10px;align-items:center}
select{font:13px system-ui;padding:3px 6px}iframe{flex:1;border:0}</style></head>
<body><header><b>run:</b><select id="s" onchange="f.src=this.value">${options}</select>
<a href="../runs/runs.md" style="color:#6b9fd8">runs.md</a></header>
<iframe name="f" id="f" src="${runDirs.length ? '../runs/' + runDirs[0] + '/chart.html' : ''}"></iframe></body></html>`,
    );

    console.log(summary);
    console.log(`-> ${runDir}`);
  });

bandOptions(
  program
    .command('bands')
    .description('Precompute the band series for a period (pure function of bins + params; cached by param hash)')
    .requiredOption('-s, --symbol <symbol>')
    .requiredOption('--from <iso>')
    .requiredOption('--to <iso>')
    .option('--interval <i>', 'bin interval: 1m or 5m', '1m'),
).action(async (o) => {
  const config = loadConfig();
  const binMinutes = parseInt(o.interval, 10);

  await writeBandSeries(
    config, o.symbol, o.from, o.to,
    streamBins(config, o.symbol, o.from, o.to, o.interval),
    bandParamsFrom(o), binMinutes,
  );
});

bandOptions(
  program
    .command('zones')
    .description('Interactive candle chart with band zones overlaid (reads the precomputed band series)')
    .requiredOption('-s, --symbol <symbol>')
    .requiredOption('--from <iso>')
    .requiredOption('--to <iso>'),
).action(async (o) => {
  const config = loadConfig();
  const params = bandParamsFrom(o);
  const hash = createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 8);
  const bandsPath = join(symbolDir(config, o.symbol), `bands.${o.from}_${o.to}.${hash}.ndjson`);

  if (! existsSync(bandsPath)) {
    throw new Error(`band series missing for these params — run: poc bands -s ${o.symbol} --from ${o.from} --to ${o.to} (hash ${hash})`);
  }

  const bins = await loadBins(config, o.symbol, o.from, o.to);
  const bands = readFileSync(bandsPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const htmlDir = join(symbolDir(config, o.symbol), 'html');
  mkdirSync(htmlDir, { recursive: true });
  const out = join(htmlDir, `zones.${o.from}_${o.to}.${hash}.html`);

  renderZonesChart(bins, bands, out, `${o.symbol} zones ${o.from} → ${o.to} (params ${hash})`);
  console.log(`-> ${out}`);
});

program
  .command('to-parquet')
  .description('Convert extracted CSVs/NDJSON to zstd Parquet (columnar tier for fast experiments)')
  .requiredOption('-s, --symbol <symbol>')
  .option('--tables <list>', 'comma-separated: quote,trade,bins', 'bins,quote,trade')
  .action(async (o) => {
    const { toParquet } = await import('./parquet/convert');

    await toParquet(loadConfig(), o.symbol, o.tables.split(','));
  });

program
  .command('import')
  .description('Import raw all-symbol daily gzips → per-symbol Parquet, one pass, banked per (table, year)')
  .option('--tables <list>', 'comma-separated: quote,trade', 'trade,quote')
  .option('--years <list>', 'comma-separated years (default: every year under raw/<table>/)')
  .option('--until <YYYYMMDD>', 'latest day to include')
  .option('--force', 're-import years already recorded in the manifest')
  .action(async (o) => {
    const { importRaw } = await import('./parquet/import');

    await importRaw(loadConfig(), {
      tables: o.tables.split(','),
      years: o.years ? o.years.split(',') : [],
      force: Boolean(o.force),
      until: o.until,
    });
  });

program
  .command('import-bins')
  .description('Import Mongo bin collections → per-symbol Parquet, banked per (collection, year)')
  .option('--collections <list>', 'comma-separated Mongo bin collections', 'tradeBin1m,tradeBin5m')
  .option('--years <list>', 'comma-separated years (default: the collection span)')
  .option('--until <YYYYMMDD>', 'latest day to include')
  .option('--force', 're-import years already recorded in the manifest')
  .action(async (o) => {
    const { importBins } = await import('./parquet/bins');

    await importBins(loadConfig(), {
      collections: o.collections.split(','),
      years: o.years ? o.years.split(',') : [],
      force: Boolean(o.force),
      until: o.until,
    });
  });

program
  .command('make-bins')
  .description('Generate bins from trade ticks (1s is the floor; coarser sizes compose upward)')
  .option('--interval <iv>', 'bin interval', '1s')
  .option('-s, --symbols <list>', 'comma-separated symbols (default: all with trade data)')
  .option('--years <list>', 'comma-separated years (default: every year present)')
  .option('--force', 'rebuild chunks already banked')
  .action(async (o) => {
    const { makeBins } = await import('./bins/make');

    await makeBins(loadConfig(), {
      interval: o.interval,
      symbols: o.symbols ? o.symbols.split(',') : [],
      years: o.years ? o.years.split(',') : [],
      force: Boolean(o.force),
    });
  });

program
  .command('precompute-indicators')
  .description('Compute registered indicators over full history → Parquet cache (DuckDB). Never recomputed on request.')
  .option('-s, --symbol <symbol>', 'single symbol (omit with --all)')
  .option('--all', 'every symbol that has bins')
  .option('--only <ids>', 'comma-separated indicator ids (default: all registered)')
  .option('--force', 'recompute even if already cached')
  .action(async (o) => {
    const { precomputeAllSymbols, precomputeIndicators } = await import('./indicators/precompute');
    const opts = { only: o.only ? o.only.split(',') : undefined, force: Boolean(o.force) };

    if (o.all) {
      await precomputeAllSymbols(loadConfig(), opts);

      return;
    }

    if (! o.symbol) {
      throw new Error('pass -s <symbol> or --all');
    }

    await precomputeIndicators(loadConfig(), o.symbol, opts);
  });

program
  .command('precompute-features')
  .description('Compute microstructure features (trade/quote) → per-minute Parquet cache, chunked and banked per year.')
  .option('-s, --symbol <symbol>', 'single symbol (omit with --all)')
  .requiredOption('--source <source>', 'trade | quote')
  .option('--all', 'every symbol that has the source table')
  .option('--years <list>', 'comma-separated years (default: every year the source covers)')
  .option('--force', 'recompute years already banked')
  .action(async (o) => {
    const { precomputeFeatures, precomputeFeaturesAllSymbols } = await import('./features/precompute');
    const opts = {
      source: o.source,
      years: o.years ? o.years.split(',') : undefined,
      force: Boolean(o.force),
    };

    if (o.all) {
      await precomputeFeaturesAllSymbols(loadConfig(), opts);

      return;
    }

    if (! o.symbol) {
      throw new Error('pass -s <symbol> or --all');
    }

    await precomputeFeatures(loadConfig(), o.symbol, opts);
  });

program.parseAsync();
