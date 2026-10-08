#!/usr/bin/env bash
# One-command install on a fresh Ubuntu/Debian server with Docker:  bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Installing Docker…"; curl -fsSL https://get.docker.com | sh; }

if [ ! -f .env ]; then
  cp .env.example .env
  read -rp "Domain (e.g. waqfak.sa): " DOMAIN
  read -rp "Email for TLS certificates: " ACME
  hex() { openssl rand -hex 24; }
  b64() { openssl rand -base64 32; }
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|; s|^ACME_EMAIL=.*|ACME_EMAIL=${ACME}|" .env
  sed -i "s|^POSTGRES_SUPERUSER_PASSWORD=.*|POSTGRES_SUPERUSER_PASSWORD=$(hex)|; s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$(hex)|; s|^OWNER_DB_PASSWORD=.*|OWNER_DB_PASSWORD=$(hex)|" .env
  sed -i "s|^MASTER_KEY=.*|MASTER_KEY=$(b64)|; s|^HASH_KEY=.*|HASH_KEY=$(b64)|; s|^SESSION_SECRET=.*|SESSION_SECRET=$(b64)|" .env
  chmod 600 .env
  echo "→ .env created with fresh secrets. Back up MASTER_KEY offline now."
fi

docker compose up -d --build
echo "Waiting for the app…"
for i in $(seq 1 60); do docker compose exec -T app curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 3; done
docker compose ps
cat <<MSG

Next step — create the first administrator (credentials are printed once):
  docker compose run --rm migrate npx tsx --conditions=react-server scripts/bootstrap-admin.ts --email you@domain --phone 05XXXXXXXX --name "الاسم"
MSG
