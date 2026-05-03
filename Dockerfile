# syntax=docker/dockerfile:1.6
#
# TrendJack — multi-stage Docker build.
#
#   1. deps    : install node_modules (cached layer)
#   2. builder : run prisma generate + next build
#   3. runner  : minimal runtime image (~150MB) with Next standalone output
#
# Build:  docker build -t trendjack .
# Run:    docker run -p 3000:3000 -e SESSION_SECRET=$(openssl rand -hex 32) \
#                                  -e DATABASE_URL=file:/data/dev.db \
#                                  -v trendjack-data:/data \
#                                  trendjack
#
# For Postgres in prod: change prisma/schema.prisma provider to "postgresql"
# and set DATABASE_URL to your Postgres connection string.

# ─── deps ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
RUN npm ci --omit=optional --no-audit --no-fund

# ─── builder ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client. Build-time only — runtime db push happens at boot.
RUN npx prisma generate

# Next standalone output trims the runtime image dramatically.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── runner ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl tini
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for the runtime
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy the standalone Next build output + static + public assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma schema + generated client are needed at runtime for db push
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Boot script: run prisma db push (idempotent), then start the server
RUN <<'EOF' cat > /app/boot.sh
#!/bin/sh
set -e
mkdir -p /data
echo "[boot] applying schema (prisma db push)…"
npx --no-install prisma db push --skip-generate --accept-data-loss || true
echo "[boot] starting server on :${PORT}"
exec node server.js
EOF
RUN chmod +x /app/boot.sh && chown nextjs:nodejs /app/boot.sh

USER nextjs
EXPOSE 3000

# tini reaps zombie processes properly when running as PID 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/boot.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
