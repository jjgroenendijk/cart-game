#!/usr/bin/env bash
# check-knowledge-sync: enforce that a docs/knowledge/*.md file is touched
# whenever src/ changes. Pre-commit calls --staged; CI calls --env or --diff.
set -euo pipefail

mode="${1:---staged}"

case "$mode" in
--staged)
	files=$(git diff --cached --name-only)
	;;
--diff)
	ref="${2:?--diff requires a range, e.g. origin/main...HEAD}"
	files=$(git diff --name-only "$ref")
	;;
--env)
	if [ -n "${VERIFY_BASE_SHA:-}" ] && [ -n "${VERIFY_HEAD_SHA:-}" ]; then
		files=$(git diff --name-only "${VERIFY_BASE_SHA}..${VERIFY_HEAD_SHA}")
	elif [ -n "${GITHUB_BASE_REF:-}" ]; then
		files=$(git diff --name-only "origin/${GITHUB_BASE_REF}...HEAD")
	else
		files=$(git diff --name-only "origin/main...HEAD")
	fi
	;;
*)
	echo "usage: check-knowledge-sync.sh [--staged|--diff <range>|--env]" >&2
	exit 2
	;;
esac

src_changed=0
knowledge_changed=0
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
	src/*) src_changed=1 ;;
	docs/knowledge/*.md) knowledge_changed=1 ;;
	esac
done <<<"$files"

if [ "$src_changed" -eq 1 ] && [ "$knowledge_changed" -eq 0 ]; then
	echo "[knowledge-sync] [ERROR] commit changes src/ without a docs/knowledge/*.md touch." >&2
	echo "[knowledge-sync] update the relevant knowledge wiki file(s) in this commit." >&2
	echo "[knowledge-sync] (no bypass: every src/ change must accompany a wiki touch.)" >&2
	exit 1
fi

echo "[knowledge-sync] [OK]"
