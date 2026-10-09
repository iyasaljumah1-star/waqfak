# syntax=docker/dockerfile:1.7
# Waqfak (وقفك) — images. Targets:
#   runner : the web app (Next.js standalone server)               → docker build --target runner
#   tools  : migrations, seeds, scheduled jobs, admin bootstrap    → docker build --target tools
#   staging: (default, last stage) all-in-one preview for single-container hosts such as Railway:
#            bootstraps DB roles + secrets, migrates, seeds demo data once, runs jobs + server. Not for production.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── tools: full source + deps (tsx) for one-off tasks ──
FROM node:22-bookworm-slim AS tools
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
USER node
CMD ["npm", "run", "db:migrate"]

# ── runner: minimal web server ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    CHROMIUM_PATH=/usr/bin/chromium STORAGE_DIR=/data/storage
# Chromium renders PDF reports; fonts are embedded by the app, these are fallbacks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/storage && chown -R node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

# ── staging: all-in-one preview (default target, used by Railway/Render) ──
FROM tools AS staging
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ \
 && mkdir -p /data
ENV CHROMIUM_PATH=/usr/bin/chromium DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["sh", "scripts/staging/start.sh"]
