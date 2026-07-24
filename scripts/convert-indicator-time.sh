#!/usr/bin/env bash
# One-off migration: indicator caches stored `t` as text; store it as TIMESTAMP.
#
# Text timestamps cannot be pruned by Parquet statistics, so every range filter
# became a full column scan — seconds per file, and the API endpoint that read
# 49 of them took ~30 s. The importer and precompute writer now emit TIMESTAMP;
# this converts what is already on disk.
#
#   systemd-run --user --unit=poc-tconv bash scripts/convert-indicator-time.sh
#   tail -f $POC_DIR/convert-indicator-time.log
#
# Idempotent and resumable: files already TIMESTAMP are skipped, and each file
# is converted to a sibling then renamed, so an interrupted run never leaves a
# half-written cache in place.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
SYMBOL="${SYMBOL:-XBTUSD}"
DIR="$POC_DIR/$SYMBOL/indicators"

exec >> "$POC_DIR/convert-indicator-time.log" 2>&1

echo "======== CONVERT START $(date -u)  $DIR"

converted=0
skipped=0

for path in "$DIR"/*.parquet; do
  file=$(basename "$path")

  case "$file" in _*) continue ;; esac

  rm -f "$path.new"

  type=$($DUCKDB -noheader -list -c "SELECT typeof(t) FROM read_parquet('$path') LIMIT 1" 2>/dev/null)

  if [ "$type" != "VARCHAR" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if $DUCKDB -c "COPY (SELECT CAST(t AS TIMESTAMP) AS t, v FROM read_parquet('$path') ORDER BY t)
                 TO '$path.new' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000);" >/dev/null 2>&1; then
    mv "$path.new" "$path"
    converted=$((converted + 1))
    echo "  $file -> TIMESTAMP"
  else
    rm -f "$path.new"
    echo "  $file FAILED (left unchanged)"
  fi
done

echo "======== CONVERT END $(date -u)  converted=$converted skipped=$skipped"
