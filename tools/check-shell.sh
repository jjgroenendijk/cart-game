#!/usr/bin/env bash
# check-shell: shellcheck + shfmt gate for .githook/* scripts.
# Skips gracefully when the tools are absent so local dev is not blocked;
# CI installs both via apt-get (see .github/workflows/ci.yml).
set -euo pipefail

if ! command -v shellcheck >/dev/null 2>&1; then
	echo "[lint:shell] shellcheck not found; skipping"
	exit 0
fi
if ! command -v shfmt >/dev/null 2>&1; then
	echo "[lint:shell] shfmt not found; skipping"
	exit 0
fi

shellcheck .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
