#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export PORT="${PORT:-8787}"

if [[ ! -f public/index.html ]]; then
  echo "public/index.html is missing. Run: npm run build" >&2
  exit 1
fi

node scripts/link-static-assets.mjs

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti:"${PORT}" | xargs -r kill 2>/dev/null || true
fi
pkill -f "caddy run --config $(pwd)/Caddyfile" 2>/dev/null || true
pkill -f "scripts/dev-server.mjs" 2>/dev/null || true
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f workerd 2>/dev/null || true
sleep 0.5

exec node scripts/dev-server.mjs
