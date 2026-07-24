#!/usr/bin/env bash
# Mongo bin collections → per-symbol Parquet dataset.
#
# Launch capped and detached (HANDOFF §1):
#
#   systemd-run --user -p MemoryHigh=4G -p MemoryMax=6G \
#     --unit=poc-bins bash scripts/import-bins.sh
#
#   tail:  tail -f $POC_DIR/import-bins.log
#
# Safe to run alongside scripts/import.sh: different table names, different
# staging dirs. Banked per (collection, year) in $POC_DIR/parquet-import.json,
# so re-running tops up only what is missing.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
UNTIL="${UNTIL:-20260630}"
COLLECTIONS="${COLLECTIONS:-tradeBin1m,tradeBin5m,tradeBin1h,tradeBin1d}"

exec >> "$POC_DIR/import-bins.log" 2>&1


cd "$REPO" || exit 1

echo "======== BINS IMPORT START $(date -u)  until=$UNTIL  collections=$COLLECTIONS"

/usr/bin/time -f "======== peak RSS %M KB, elapsed %E" \
  $PNPM poc import-bins --collections "$COLLECTIONS" --until "$UNTIL"

status=$?  # capture before any command substitution resets it

echo "======== BINS IMPORT END $(date -u) exit=$status"
