#!/usr/bin/env bash
# Long-running precompute batch (features + indicators).
#
# Both steps are chunked and banked per year, so an interrupt costs one chunk
# and re-running resumes where it stopped. SOURCES limits which feature sources
# run (e.g. SOURCES=trade while quote is being rewritten by another job).
#
# Never launch heavy jobs unbounded — an uncapped run froze the whole
# workstation once. Always run this as a capped, detached transient unit so a
# runaway is OOM-killed as a job and the desktop survives:
#
#   systemd-run --user -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=4G \
#     --unit=poc-overnight bash scripts/overnight.sh
#
#   inspect:  systemctl --user show poc-overnight -p ActiveState -p MemoryCurrent
#   stop:     systemctl --user stop poc-overnight
#
# Progress -> $POC_DIR/overnight.log; sentinel -> $POC_DIR/overnight.DONE.
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
SYMBOL="${SYMBOL:-XBTUSD}"
SOURCES="${SOURCES-trade,quote}"

# Indicator precompute holds the whole bin history as JS objects (~5 M for
# XBTUSD), well past Node's ~2 GB default heap. Raised here rather than in the
# code so the cgroup cap stays the real limit. The structural fix is chunked
# indicator computation — see ROADMAP 2f.
export NODE_OPTIONS="--max-old-space-size=6144"

# `${SOURCES-...}` not `:-`: an explicitly empty SOURCES means "skip features".

exec >> "$POC_DIR/overnight.log" 2>&1


cd "$REPO" || exit 1

rm -f "$POC_DIR/overnight.DONE"

# Run a step under /usr/bin/time so peak RSS is recorded per step.
step () {
  local label="$1"; shift

  echo "=== [$label] START $(date -u)"
  /usr/bin/time -f "=== [$label] peak RSS %M KB, elapsed %E" "$@"
  echo "=== [$label] exit=$? $(date -u)"
}

echo "======== RUN START $(date -u)  symbol=$SYMBOL"

for source in ${SOURCES//,/ }; do
  step "features:$source" $PNPM poc precompute-features -s "$SYMBOL" --source "$source"
done

step "indicators" $PNPM poc precompute-indicators -s "$SYMBOL"

N=$(ls "$POC_DIR/$SYMBOL/indicators/"*.parquet 2>/dev/null | wc -l)

echo "======== RUN END $(date -u)  files: $N"
echo "$N files, ended $(date -u)" > "$POC_DIR/overnight.DONE"
