#!/bin/bash
# Stops any running TrendJack dev server, clears the .next cache, and
# starts a fresh `npm run dev`. Run this when Fast Refresh has thrashed
# the build manifest and CSS / JS chunks are 404-ing.
cd "$(dirname "$0")"

echo "[1/4] killing any process listening on :3000…"
PIDS=$(lsof -ti tcp:3000 2>/dev/null)
if [ -n "$PIDS" ]; then
  kill -9 $PIDS 2>/dev/null
  sleep 1
  echo "      killed: $PIDS"
else
  echo "      nothing to kill on :3000"
fi

echo "[2/4] killing stray next-server processes…"
pkill -9 -f "next.*dev" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
sleep 1

echo "[3/4] removing .next/ build cache…"
rm -rf .next
echo "      .next/ cleared"

echo "[4/4] starting fresh dev server…"
echo ""
echo "    → http://localhost:3000"
echo "    Once you see 'Ready in …', hard-refresh your browser tab"
echo "    (Cmd+Shift+R) to pick up the new CSS bundle."
echo ""
exec npm run dev
