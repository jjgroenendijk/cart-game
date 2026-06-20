#!/usr/bin/env bash
# 01-format: prettier (code/config) + shfmt (hook scripts) on staged files,
# then re-stage so the index holds formatted bytes (no working-tree drift).
set -euo pipefail

prettier_files=()
shfmt_files=()
while IFS= read -r -d '' f; do
	case "$f" in
	*.ts | *.js | *.cjs | *.mjs | *.md | *.json | *.yml | *.yaml | *.html)
		prettier_files+=("$f")
		;;
	.githook/pre-commit | .githook/commit-msg | .githook/pre-commit.d/*.sh)
		shfmt_files+=("$f")
		;;
	esac
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if [ "${#prettier_files[@]}" -gt 0 ]; then
	echo "[pre-commit] formatting ${#prettier_files[@]} file(s) with prettier"
	prettier --config tools/.prettierrc --ignore-path tools/.prettierignore --write "${prettier_files[@]}"
	git add -- "${prettier_files[@]}"
fi

if [ "${#shfmt_files[@]}" -gt 0 ]; then
	echo "[pre-commit] formatting ${#shfmt_files[@]} hook file(s) with shfmt"
	shfmt -w -ln bash -- "${shfmt_files[@]}"
	git add -- "${shfmt_files[@]}"
fi
