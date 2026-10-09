#!/usr/bin/env bash
# Hands-on preview on your own computer (needs Docker Desktop). Demo data only; OTP codes show on screen.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env.preview ]; then
  b64() { openssl rand -base64 32; }; hex() { openssl rand -hex 16; }
  cat > .env.preview <<ENV
POSTGRES_SUPERUSER_PASSWORD=$(hex)
APP_DB_PASSWORD=$(hex)
OWNER_DB_PASSWORD=$(hex)
MASTER_KEY=$(b64)
HASH_KEY=$(b64)
SESSION_SECRET=$(b64)
ENV
fi
set -a; . ./.env.preview; set +a
mkdir -p preview-output
docker compose -f docker-compose.preview.yml --env-file .env.preview up -d --build
echo "Waiting for http://localhost:3000 …"
for i in $(seq 1 100); do curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break; sleep 3; done
echo "Open http://localhost:3000 — demo accounts: preview-output/demo-credentials.json"
echo "Stop:   docker compose -f docker-compose.preview.yml down      (add -v to erase the demo data)"
