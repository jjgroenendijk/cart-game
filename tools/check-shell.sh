#!/usr/bin/env bash
# check-shell: shellcheck + shfmt gate for .githook/* scripts.
# The tools are mandatory: tools/setup-cloud.sh (and CI) install them. A missing
# tool is a hard error, never a silent skip.
set -euo pipefail

for tool in shellcheck shfmt; do
	command -v "$tool" >/dev/null 2>&1 || {
		echo "[lint:shell] [ERROR] $tool not installed; run tools/setup-cloud.sh" >&2
		exit 1
	}
done

shellcheck .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/commit-msg .githook/pre-commit.d/*.sh
