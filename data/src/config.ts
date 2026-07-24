import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { PocConfig } from '@poc/core';

/**
 * Config from the repo-root .env (DB_USER/DB_PASS/DB_PORT for the local
 * MongoDB; optional POC_DIR/VAULT_DIR to relocate the data). See .env.example.
 */
export function loadConfig(): PocConfig {
  const env = { ...readEnvFile(), ...process.env } as Record<string, string>;

  const user = env.DB_USER;
  const pass = env.DB_PASS;
  const port = env.DB_PORT;

  if (! user || ! pass || ! port) {
    throw new Error('DB_USER/DB_PASS/DB_PORT missing from .env (see .env.example)');
  }

  return {
    dbUri: `mongodb://${user}:${pass}@localhost:${port}/tradebot?authSource=admin`,
    vaultDir: env.VAULT_DIR || '/storage/bitmex/vault',
    pocDir: env.POC_DIR || '/storage/bitmex/scalper-poc',
  };
}

/** Reads the repo-root .env, walking up from this file until found. */
function readEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = findUp('.env', dirname(fileURLToPath(import.meta.url)));

  if (! path) {
    return out;
  }

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);

    if (m) {
      out[m[1]] = m[2];
    }
  }

  return out;
}

/** Walk up directories from `start` looking for `name`; undefined if not found. */
function findUp(name: string, start: string): string | undefined {
  let dir = start;

  for (;;) {
    const candidate = resolve(dir, name);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      return undefined;
    }

    dir = parent;
  }
}
