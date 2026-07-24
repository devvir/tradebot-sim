import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';

import { symbolDir } from '@poc/core';
import type { ExtractWindowOptions, PocConfig } from '@poc/core';

/**
 * Extract one symbol's rows for a date window from vault daily buckets.
 *
 * Vault files are NEVER processed in place: each needed daily bucket is
 * first copied verbatim into <pocDir>/raw/<table>/, and all reading
 * happens on the copies — the vault stays pristine (POC.md).
 *
 * Output: <pocDir>/<symbol>/<table>.<from>_<to>.csv (plain, uncompressed).
 */
export async function extractWindow(config: PocConfig, opts: ExtractWindowOptions): Promise<string> {
  const days = listDays(opts.from, opts.to);
  const rawDir = join(config.pocDir, 'raw', opts.table);
  const outDir = symbolDir(config, opts.symbol);

  mkdirSync(rawDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, `${opts.table}.${opts.from}_${opts.to}.csv`);
  const out = createWriteStream(outPath);

  let header = false;
  let rows = 0;

  for (const day of days) {
    const year = day.slice(0, 4);
    const name = `${day}.csv.gz`;

    /**
     * Source resolution: buckets pre-placed in raw/ (flat or per-year) are
     * used directly; otherwise the vault copy-first rule applies (vault is
     * never processed in place).
     */
    let source = [join(rawDir, name), join(rawDir, year, name)].find(existsSync);

    if (! source) {
      const vaultFile = join(config.vaultDir, opts.table, year, name);

      if (! existsSync(vaultFile)) {
        console.log(`  (missing, skipped: ${opts.table} ${name})`);
        continue;
      }

      source = join(rawDir, name);
      copyFileSync(vaultFile, source);
    }

    rows += await filterDay(source, opts.symbol, out, header, (h) => {
      header = h;
    });
  }

  await new Promise((res) => out.end(res));

  console.log(`${opts.symbol} ${opts.table} ${opts.from}..${opts.to}: ${rows} rows -> ${outPath}`);

  return outPath;
}

function listDays(from: string, to: string): string[] {
  const days: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (d <= end) {
    days.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return days;
}

async function filterDay(
  file: string,
  symbol: string,
  out: NodeJS.WritableStream,
  headerWritten: boolean,
  setHeader: (h: boolean) => void,
): Promise<number> {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  const needle = `,${symbol},`;

  let first = true;
  let rows = 0;

  for await (const line of rl) {
    if (first) {
      first = false;

      if (! headerWritten) {
        out.write(line + '\n');
        setHeader(true);
      }

      continue;
    }

    if (line.includes(needle)) {
      out.write(line + '\n');
      rows++;
    }
  }

  return rows;
}
