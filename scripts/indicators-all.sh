#!/usr/bin/env bash
# Indicator caches for every symbol.
#
# Resumable by design: no --force, so an indicator already cached and up to date
# is skipped without loading bins. A crash costs the symbol in flight, never the
# run. Stale timeframe caches were deleted beforehand so they recompute.
#
#   systemd-run --user -p MemoryHigh=12G -p MemoryMax=16G \
#     --unit=poc-ind-all bash scripts/indicators-all.sh
#
# Heap: precompute holds a symbol's whole bin history as JS objects (XBTUSD
# peaked at 6.46 GB). 12 GB gives headroom until ROADMAP 2f makes the
# computation chunked. Waits for the 1s bin job so they do not fight for cores.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

exec >> "$POC_DIR/indicators-all.log" 2>&1
cd "$REPO" || exit 1

export NODE_OPTIONS="--max-old-space-size=12288"

echo "======== INDICATORS ALL START $(date -u)"

while systemctl --user is-active --quiet poc-1s; do
  echo "  waiting for poc-1s… $(date -u)"
  sleep 300
done

echo "=== XBTUSD first, so the clock-alignment fix is verifiable early $(date -u)"
/usr/bin/time -f "=== XBTUSD peak RSS %M KB, elapsed %E" $PNPM poc precompute-indicators -s XBTUSD

echo "=== all symbols $(date -u)"
/usr/bin/time -f "=== all peak RSS %M KB, elapsed %E" $PNPM poc precompute-indicators --all

echo "======== INDICATORS ALL END $(date -u)"
