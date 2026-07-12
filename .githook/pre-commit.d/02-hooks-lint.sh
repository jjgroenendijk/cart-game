#!/usr/bin/env bash
# 02-hooks-lint: shellcheck and shfmt all hook scripts.
# Skips gracefully when the tools are absent (e.g. cloud images without them)
# so commits are not blocked; CI installs both and stays the enforcement
# backstop (see .github/workflows/ci.yml and tools/check-shell.sh).
set -euo pipefail

echo "[pre-commit] lint hook scripts"

if ! command -v shellcheck >/dev/null 2>&1; then
	echo "[pre-commit] shellcheck not found; skipping hook lint"
	exit 0
fi
if ! command -v shfmt >/dev/null 2>&1; then
	echo "[pre-commit] shfmt not found; skipping hook lint"
	exit 0
fi

shellcheck .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
