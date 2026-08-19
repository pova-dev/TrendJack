#!/bin/bash
# Runs npm run build and npm test, writing combined output to a log file
# that Claude can then read to surface any failures.
cd "$(dirname "$0")"
LOG="./build-and-test.log"
echo "=== START $(date) ===" > "$LOG"
echo "" >> "$LOG"
echo "=== node + npm versions ===" >> "$LOG"
node --version >> "$LOG" 2>&1
npm --version >> "$LOG" 2>&1
echo "" >> "$LOG"
echo "=== npm run build ===" >> "$LOG"
npm run build >> "$LOG" 2>&1
BUILD_EXIT=$?
echo "" >> "$LOG"
echo "BUILD exit code: $BUILD_EXIT" >> "$LOG"
echo "" >> "$LOG"
echo "=== npm test ===" >> "$LOG"
npm test >> "$LOG" 2>&1
TEST_EXIT=$?
echo "" >> "$LOG"
echo "TESTS exit code: $TEST_EXIT" >> "$LOG"
echo "" >> "$LOG"
echo "=== DONE $(date) ===" >> "$LOG"
echo "" >> "$LOG"
echo "Build + tests complete. Exit codes: build=$BUILD_EXIT tests=$TEST_EXIT"
echo "Full log at: $LOG"
echo ""
echo "Window will close in 3 seconds..."
sleep 3
