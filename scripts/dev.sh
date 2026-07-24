#!/usr/bin/env bash
# Dev servers: the API (@poc/server) and the Vite UI (@poc/web).
#
# Launch detached so they survive the shell that started them — a plain
# background job dies with its parent, which is how the UI silently vanishes:
#
#   systemd-run --user --unit=poc-api bash scripts/dev.sh api
#   systemd-run --user --unit=poc-web bash scripts/dev.sh web
#
#   stop:  systemctl --user stop poc-api poc-web
#   logs:  journalctl --user -u poc-web -f
#
# API  -> http://127.0.0.1:8788   (Vite proxies /api here)
# UI   -> http://127.0.0.1:5173
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNPM=/home/x/.local/share/pnpm/pnpm

export PATH="/home/x/.local/bin:/home/x/.local/share/pnpm:$PATH"

cd "$REPO" || exit 1

case "${1:-}" in
  api) exec $PNPM --filter @poc/server exec tsx src/index.ts api --port "${PORT:-8788}" ;;
  web) exec $PNPM --filter @poc/web exec vite --host 127.0.0.1 --port "${PORT:-5173}" ;;
  *)   echo "usage: dev.sh api|web" >&2; exit 2 ;;
esac
