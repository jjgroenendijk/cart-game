#!/usr/bin/env bash
# 02-hooks-lint: shellcheck and shfmt all hook scripts.
# The tools are mandatory: tools/setup-cloud.sh (and CI) install them. A missing
# tool is a hard error, never a silent skip.
set -euo pipefail

echo "[pre-commit] lint hook scripts"

for tool in shellcheck shfmt; do
	command -v "$tool" >/dev/null 2>&1 || {
		echo "[pre-commit] [ERROR] $tool not installed; run tools/setup-cloud.sh" >&2
		exit 1
	}
done

shellcheck .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
