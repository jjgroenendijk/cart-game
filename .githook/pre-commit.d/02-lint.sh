#!/usr/bin/env bash
# 02-lint: eslint (ts/js) + markdownlint (md) + shellcheck/shfmt (hook scripts).
set -euo pipefail

echo "[pre-commit] lint (eslint + markdownlint + shellcheck)"

npm run --silent lint:eslint
npm run --silent lint:md

# Lint the hook scripts themselves (plain shell, zero-dep).
shellcheck .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
