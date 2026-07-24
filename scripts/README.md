# scripts/

Launchers for the long-running data jobs. Everything here is a thin wrapper
around a `pnpm poc <command>` — the logic lives in the packages, never in bash.

## The one rule

**Never launch a heavy job unbounded.** An uncapped run once froze the whole
workstation. Always use a capped, detached transient unit:

```bash
systemd-run --user -p MemoryHigh=6G -p MemoryMax=8G -p MemorySwapMax=4G \
  --unit=poc-<name> bash /absolute/path/to/scripts/<script>.sh
```

The path must be **absolute** — a transient unit does not inherit your cwd.

```bash
systemctl --user show poc-<name> -p ActiveState -p MemoryCurrent   # status
systemctl --user stop poc-<name>                                   # stop
tail -f $POC_DIR/<script>.log                                      # progress
```

`MemoryCurrent` counts reclaimable page cache, so a number near the cap is not
alarm-worthy. Check what is actually allocated:

```bash
grep -E '^(anon|file) ' /sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/poc-<name>.service/memory.stat
```

`anon` is real; `file` is cache the kernel drops under pressure. `memory.events`
should show `oom_kill 0`.

## Scripts

| script | what it does | typical launch |
| --- | --- | --- |
| `import.sh` | Raw all-symbol daily gzips → per-symbol Parquet, every symbol and year, both `trade` and `quote`. Long (hours). | `MemoryHigh=6G MemoryMax=8G` |
| `import-bins.sh` | Mongo bin collections (`tradeBin1m/5m/1h/1d`) → per-symbol Parquet. | `MemoryHigh=4G MemoryMax=6G` |
| `overnight.sh` | Feature + indicator precompute. **Currently disabled** — see the warning in the file. | `MemoryHigh=8G MemoryMax=12G` |

`import.sh` and `import-bins.sh` are safe to run **at the same time**: different
table names, different staging directories.

## Chunked and banked — why re-running is always safe

Every importer splits its work by `(table, year)` and records each completed
chunk in `$POC_DIR/parquet-import.json` before starting the next. So:

- a crash, an OOM kill, or a `systemctl stop` costs **one year**, never the run;
- re-running the same script **resumes** at the first unbanked chunk;
- monthly top-ups are the same command — only missing chunks are computed;
- `--force` re-does chunks already banked (needed when a partial year grows).

This is not a nicety. The single biggest process failure in this project was one
atomic full-range query that returned *zero* output after hours of compute, three
times over. Chunk it, bank it.

## Environment

`POC_DIR` (default `/storage/bitmex/scalper-poc`), `SYMBOL`, `UNTIL`
(`YYYYMMDD`), `COLLECTIONS` — all overridable per run. Mongo credentials come
from the repo-root `.env`.

Use the real binaries, not the zsh wrappers, which recurse infinitely:
`/home/x/.local/share/pnpm/pnpm`, `/home/x/.local/bin/node`,
`/home/x/.local/bin/duckdb`.
