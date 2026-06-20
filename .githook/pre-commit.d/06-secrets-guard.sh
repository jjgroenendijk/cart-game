#!/usr/bin/env bash
# 06-secrets-guard: secretlint over staged file contents.
set -euo pipefail

targets=()
while IFS= read -r -d '' f; do
	targets+=("$f")
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if [ "${#targets[@]}" -gt 0 ]; then
	echo "[pre-commit] secrets scan (${#targets[@]} file(s))"
	secretlint --secretlintrc tools/.secretlintrc.json --no-glob "${targets[@]}"
fi
