#!/usr/bin/env bash
# One-off migration: rewrite TIMESTAMPTZ columns as plain TIMESTAMP (UTC).
#
# Everything in this project is UTC. TIMESTAMPTZ renders and converts against
# the *session* timezone, so on this machine (+04) a reader that forgets
# `SET TimeZone='UTC'` silently shifts every value by four hours. Plain
# TIMESTAMP removes the failure mode instead of relying on every caller.
#
#   systemd-run --user -p MemoryHigh=6G -p MemoryMax=8G \
#     --unit=poc-tznorm bash scripts/normalize-timestamps.sh
#   tail -f $POC_DIR/normalize-timestamps.log
#
# Idempotent and resumable: files already plain TIMESTAMP are skipped, each is
# written to a sibling and renamed only after its row count matches the source,
# so an interrupt can never leave a truncated or half-converted file.
set -uo pipefail

POC_DIR="${POC_DIR:-/storage/bitmex/scalper-poc}"
TABLE="${TABLE:-quote}"
JOBS="${JOBS:-3}"
DUCKDB=/home/x/.local/bin/duckdb

export POC_DIR TABLE DUCKDB

exec >> "$POC_DIR/normalize-timestamps.log" 2>&1

convert_one() {
  local path="$1"
  local type

  type=$($DUCKDB -noheader -list -c "SELECT typeof(timestamp) FROM read_parquet('$path') LIMIT 1" 2>/dev/null)

  if [ "$type" != "TIMESTAMP WITH TIME ZONE" ]; then
    return 0
  fi

  local before after
  before=$($DUCKDB -noheader -list -c "SELECT count(*) FROM read_parquet('$path')" 2>/dev/null)

  rm -f "$path.tmp"

  # SET TimeZone='UTC' is what makes the cast keep the correct wall clock.
  if ! $DUCKDB -c "SET TimeZone='UTC'; SET threads=2;
        COPY (SELECT CAST(timestamp AS TIMESTAMP) AS timestamp, * EXCLUDE (timestamp) FROM read_parquet('$path'))
        TO '$path.tmp' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000);" >/dev/null 2>&1; then
    rm -f "$path.tmp"
    echo "  FAILED (unchanged): $path"

    return 1
  fi

  after=$($DUCKDB -noheader -list -c "SELECT count(*) FROM read_parquet('$path.tmp')" 2>/dev/null)

  if [ "$before" != "$after" ] || [ -z "$after" ]; then
    rm -f "$path.tmp"
    echo "  ROW MISMATCH $before != $after (unchanged): $path"

    return 1
  fi

  mv "$path.tmp" "$path"
  echo "  ok $path ($after rows)"
}

export -f convert_one

echo "======== TZ NORMALIZE START $(date -u)  table=$TABLE jobs=$JOBS"

# XBTUSD first so the symbol actually in use is correct early.
{
  ls -1 "$POC_DIR"/XBTUSD/parquet/"$TABLE"/*.parquet 2>/dev/null
  ls -1 "$POC_DIR"/*/parquet/"$TABLE"/*.parquet 2>/dev/null | grep -v '/XBTUSD/'
} | xargs -r -P "$JOBS" -I{} bash -c 'convert_one "$@"' _ {}

echo "======== TZ NORMALIZE END $(date -u)"
