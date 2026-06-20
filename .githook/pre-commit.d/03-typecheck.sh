#!/usr/bin/env bash
# 03-typecheck: tsc --noEmit.
set -euo pipefail

echo "[pre-commit] typecheck"
npm run --silent typecheck
