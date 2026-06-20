#!/usr/bin/env bash
# 04-test: vitest run (skips cleanly when no *.test.ts exist via passWithNoTests).
set -euo pipefail

echo "[pre-commit] tests"
npm run --silent test
