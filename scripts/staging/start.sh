#!/bin/sh
# Single-container staging entrypoint: bootstrap DB + secrets → migrate → seed (+ demo once) → daily job loop → web server.
set -e
cd "${APP_DIR:-/app}"
node scripts/staging/bootstrap.mjs /tmp/runtime.env
set -a; . /tmp/runtime.env; set +a
export DEMO_SHOW_OTP="${DEMO_SHOW_OTP:-true}" NODE_ENV=production PORT="${PORT:-3000}" HOSTNAME=0.0.0.0
mkdir -p "$STORAGE_DIR"
npm run -s db:migrate
npm run -s db:seed
if [ "${SEED_DEMO:-true}" = "true" ] && [ ! -f "$DATA_DIR/.demo-seeded" ] && [ ! -f /data/.demo-seeded ]; then
  npx tsx --conditions=react-server scripts/seed-demo.ts && touch "${DATA_DIR:-/data}/.demo-seeded"
  echo "════════ DEMO ACCOUNTS (fictional, staging only) ════════"
  cat storage/demo-credentials.json || true
  cp storage/demo-credentials.json "${DATA_DIR:-/data}/demo-credentials.json" 2>/dev/null || true
  echo "══════════════════════════════════════════════════════════"
fi
# daily compliance job every 24h (first run 10 minutes after boot)
( sleep 600; while true; do npx tsx --conditions=react-server scripts/jobs/daily.ts >/dev/null 2>&1 || true; sleep 86400; done ) &
exec node .next/standalone/server.js
