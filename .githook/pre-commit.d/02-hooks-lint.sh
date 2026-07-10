#!/usr/bin/env bash
# 02-hooks-lint: shellcheck and shfmt all hook scripts.
set -euo pipefail

echo "[pre-commit] lint hook scripts"

shellcheck .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
