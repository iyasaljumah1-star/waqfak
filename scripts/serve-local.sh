#!/usr/bin/env bash
# Local production check: (re)starts the standalone server on :3000 with .env (no Docker).
set -euo pipefail
cd "$(dirname "$0")/.."
for p in $(ps -eo pid,args | awk '$2 ~ /^next-server/ {print $1}'); do kill "$p" || true; done
sleep 1
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
set -a; . ./.env; set +a
STORAGE_DIR="$PWD/storage" PORT=3000 nohup node .next/standalone/server.js > "${LOG:-/tmp/waqfak-prod.log}" 2>&1 &
sleep 3; curl -fsS localhost:3000/api/health && echo
