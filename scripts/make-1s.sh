#!/usr/bin/env bash
# Generate 1s bins from trade ticks, after the trade re-import lands.
#
# 1s bins order by `seq` (the exchange's own trade order, added to the trade
# table on 2026-07-23), so this must not start until that import completes —
# it waits rather than assuming.
#
#   systemd-run --user -p MemoryHigh=6G -p MemoryMax=10G \
#     --unit=poc-1s bash scripts/make-1s.sh
#
# XBTUSD runs first, alone, so its cost and the acceptance test (60x 1s must
# reproduce BitMEX's own 1m bin) are visible early in the log. Then every other
# symbol. Chunked and banked per (symbol, year): safe to stop and re-run.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

exec >> "$POC_DIR/make-1s.log" 2>&1

echo "======== 1s BINS START $(date -u)"

while systemctl --user is-active --quiet poc-import; do
  echo "  waiting for poc-import… $(date -u)"
  sleep 120
done

if ! grep -q "IMPORT END .* exit=0" "$POC_DIR/import.log"; then
  echo "ABORT: trade re-import did not finish cleanly — 1s bins would order by a missing/partial seq"
  exit 1
fi

cd "$REPO" || exit 1

echo "=== XBTUSD first (cost + acceptance test) $(date -u)"
/usr/bin/time -f "=== XBTUSD peak RSS %M KB, elapsed %E" $PNPM poc make-bins --interval 1s -s XBTUSD --force

echo "=== acceptance: 60x 1s must reproduce BitMEX's own 1m bin"
$DUCKDB -noheader -list -c "
WITH mine AS (
  SELECT time_bucket(INTERVAL '1 minute', timestamp - INTERVAL 1 microsecond) + INTERVAL '1 minute' AS timestamp,
         max(high) AS high, min(low) AS low, sum(volume) AS volume, sum(trades) AS trades
  FROM read_parquet('$POC_DIR/XBTUSD/parquet/tradeBin1s/2019.parquet')
  WHERE timestamp > TIMESTAMP '2019-06-09' AND timestamp <= TIMESTAMP '2019-06-10' GROUP BY 1)
SELECT count(*) AS minutes,
       sum(CASE WHEN b.high=m.high AND b.low=m.low AND b.volume=m.volume AND b.trades=m.trades THEN 1 ELSE 0 END) AS exact_matches
FROM read_parquet('$POC_DIR/XBTUSD/parquet/tradeBin1m/2019.parquet') b JOIN mine m USING (timestamp);"

echo "=== all remaining symbols $(date -u)"
/usr/bin/time -f "=== all peak RSS %M KB, elapsed %E" $PNPM poc make-bins --interval 1s --force

echo "======== 1s BINS END $(date -u)"
