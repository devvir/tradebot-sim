#!/usr/bin/env bash
# All-symbol feature caches, overnight.
#
# Quote features first — the quote tick table is stable. Trade features must
# wait for poc-import (rewriting the trade table for `seq`), so they poll for it
# and verify a clean finish before starting: a feature aggregated from a
# half-rewritten trade year would be wrong.
#
#   systemd-run --user -p MemoryHigh=6G -p MemoryMax=8G \
#     --unit=poc-feat-all bash scripts/overnight-features.sh
#
# Chunked and banked per (symbol, year): stop and re-run freely.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

exec >> "$POC_DIR/overnight-features.log" 2>&1
cd "$REPO" || exit 1

echo "======== FEATURES ALL START $(date -u)"

echo "=== quote features (all symbols) $(date -u)"
$PNPM poc precompute-features --source quote --all

while systemctl --user is-active --quiet poc-import; do
  echo "  waiting for poc-import before trade features… $(date -u)"
  sleep 120
done

if ! grep -q "IMPORT END .* exit=0" "$POC_DIR/import.log"; then
  echo "ABORT: trade re-import unclean — trade features would read a partial table"
  exit 1
fi

echo "=== trade features (all symbols) $(date -u)"
$PNPM poc precompute-features --source trade --all

echo "======== FEATURES ALL END $(date -u)"
