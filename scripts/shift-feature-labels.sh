#!/usr/bin/env bash
# One-off: feature caches were start-labelled; shift t by +1 minute so they are
# end-labelled like every bin (BitMEX convention: stamp = interval close).
#
# GUARDED, because a shift is not idempotent: it first checks whether
# buy+sell volume already reconciles with the bin volume at an equal stamp,
# and exits untouched if so. Each file is written to a sibling and renamed
# only after its row count matches.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

exec >> "$POC_DIR/shift-feature-labels.log" 2>&1

echo "======== SHIFT START $(date -u)"

aligned=$($DUCKDB -noheader -list -c "
SELECT (SELECT CAST(a.v + b.v AS BIGINT)
        FROM read_parquet('$POC_DIR/XBTUSD/indicators/tf_buyvol_1m.parquet') a
        JOIN read_parquet('$POC_DIR/XBTUSD/indicators/tf_sellvol_1m.parquet') b USING (t)
        WHERE a.t = TIMESTAMP '2019-06-09 03:01')
     = (SELECT volume FROM read_parquet('$POC_DIR/XBTUSD/parquet/tradeBin1m/2019.parquet')
        WHERE timestamp = TIMESTAMP '2019-06-09 03:01')")

if [ "$aligned" = "true" ]; then
  echo "already end-labelled — nothing to do"
  exit 0
fi

shift_one() {
  local f="$1" before after

  before=$($DUCKDB -noheader -list -c "SELECT count(*) FROM read_parquet('$f')")
  rm -f "$f.tmp"

  if ! $DUCKDB -c "COPY (SELECT t + INTERVAL 1 minute AS t, * EXCLUDE (t)
                   FROM read_parquet('$f') ORDER BY t)
                   TO '$f.tmp' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000);" >/dev/null 2>&1; then
    rm -f "$f.tmp"; echo "  FAILED (unchanged): $f"; return 1
  fi

  after=$($DUCKDB -noheader -list -c "SELECT count(*) FROM read_parquet('$f.tmp')")

  if [ "$before" != "$after" ] || [ -z "$after" ]; then
    rm -f "$f.tmp"; echo "  MISMATCH $before != $after (unchanged): $f"; return 1
  fi

  mv "$f.tmp" "$f"
  echo "  ok $f ($after rows)"
}

for f in "$POC_DIR"/*/features/*/*.parquet \
         "$POC_DIR"/*/indicators/tf_*.parquet \
         "$POC_DIR"/*/indicators/qf_*.parquet; do
  [ -e "$f" ] && shift_one "$f"
done

echo "======== SHIFT END $(date -u)"
