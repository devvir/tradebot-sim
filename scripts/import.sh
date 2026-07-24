#!/usr/bin/env bash
# Full raw → per-symbol Parquet import (every symbol, every year, both tables).
#
# Launch capped and detached (HANDOFF §1) — never unbounded:
#
#   systemd-run --user -p MemoryHigh=6G -p MemoryMax=8G -p MemorySwapMax=4G \
#     --unit=poc-import bash scripts/import.sh
#
#   inspect:  systemctl --user show poc-import -p ActiveState -p MemoryCurrent
#   tail:     tail -f $POC_DIR/import.log
#   stop:     systemctl --user stop poc-import
#
# Chunked and banked per (table, year) in $POC_DIR/parquet-import.json, so a
# stop or crash costs one year: relaunching resumes at the first unbanked year.
# Trade runs first — it is ~15% of the bytes, so the cheap half lands early.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POC_DIR="${POC_DIR:-/storage/bitmex/scalper-poc}"
UNTIL="${UNTIL:-20260630}"
TABLES="${TABLES:-trade,quote}"
FORCE="${FORCE:-}"

exec >> "$POC_DIR/import.log" 2>&1

# Real binaries — the zsh wrappers recurse infinitely.
export PATH="/home/x/.local/bin:/home/x/.local/share/pnpm:$PATH"
PNPM=/home/x/.local/share/pnpm/pnpm

cd "$REPO" || exit 1

rm -f "$POC_DIR/import.DONE"

echo "======== IMPORT START $(date -u)  until=$UNTIL tables=$TABLES force=${FORCE:-no}"

/usr/bin/time -f "======== peak RSS %M KB, elapsed %E" \
  $PNPM poc import --tables "$TABLES" --until "$UNTIL" ${FORCE:+--force}

status=$?  # capture before any command substitution resets it

echo "======== IMPORT END $(date -u) exit=$status"
echo "ended $(date -u)" > "$POC_DIR/import.DONE"
