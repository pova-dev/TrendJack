#!/bin/bash
# Recover from corrupted SQLite DB. Kills the dev server, backs up the
# broken DB, recreates schema, restores recoverable rows, restarts.
set -e
cd "$(dirname "$0")"

echo "[1/6] killing dev server on :3000…"
PIDS=$(lsof -ti tcp:3000 2>/dev/null || true)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null || true
pkill -9 -f "next.*dev" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
sleep 2

echo "[2/6] backing up broken DB…"
mv prisma/dev.db prisma/dev.db.broken-$(date +%s)

echo "[3/6] running .recover to extract valid SQL…"
sqlite3 prisma/dev.db.broken-* ".recover" > /tmp/recovered.sql 2>/tmp/recovery-errors.log || echo "  partial recovery — continuing"
RECOVERED_LINES=$(wc -l < /tmp/recovered.sql 2>/dev/null || echo 0)
echo "      recovered $RECOVERED_LINES SQL lines"

echo "[4/6] creating fresh DB from Prisma schema…"
DATABASE_URL="file:./dev.db" npx --no-install prisma db push --skip-generate

echo "[5/6] importing recovered rows (best effort)…"
sqlite3 prisma/dev.db < /tmp/recovered.sql 2>/tmp/import-errors.log || echo "  some imports failed — see /tmp/import-errors.log"

echo "[6/6] starting fresh dev server…"
echo "    → http://localhost:3000"
echo ""
exec npm run dev
