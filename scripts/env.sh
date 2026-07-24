#!/usr/bin/env bash
# Shared environment for every script here. Source it, never execute it:
#
#   . "$(dirname "${BASH_SOURCE[0]}")/env.sh"
#
# The data root is a single knob. Set POC_DIR in the repo-root .env and both the
# TypeScript layer and these scripts follow it — rename the folder, move it to
# another partition, whatever, with no code change anywhere.
#
# Resolution order: an already-exported POC_DIR wins (so a one-off run can
# override), then .env, then the default below.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "$REPO/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO/.env"
  set +a
fi

POC_DIR="${POC_DIR:-/storage/bitmex/scalper-poc}"

# Real binaries — the zsh wrappers recurse infinitely.
export PATH="/home/x/.local/bin:/home/x/.local/share/pnpm:$PATH"
PNPM=/home/x/.local/share/pnpm/pnpm
DUCKDB=/home/x/.local/bin/duckdb

export REPO POC_DIR PNPM DUCKDB
