#!/usr/bin/env bash
# 08-file-limits: staged hand-written files stay <=600 lines and <=100 cols.
set -euo pipefail

max_lines=600
max_cols=100
bad=0

while IFS= read -r -d '' f; do
	[ -f "$f" ] || continue
	[ -L "$f" ] && continue

	case "$f" in
	node_modules/* | dist/* | package-lock.json | pnpm-lock.yaml | yarn.lock)
		continue
		;;
	# package.json: JSON script strings can't wrap across lines.
	package.json)
		continue
		;;
	esac

	case "$f" in
	*.ts | *.js | *.cjs | *.mjs | *.md | *.json | *.yml | *.yaml | *.html | *.sh) ;;
	.githook/*) ;;
	*)
		continue
		;;
	esac

	lines=$(wc -l <"$f" | tr -d ' ')
	if [ "$lines" -gt "$max_lines" ]; then
		echo "[pre-commit] [ERROR] ${f} is ${lines} lines (> ${max_lines})." >&2
		bad=1
	fi

	long_lines=$(awk -v max="$max_cols" '
		length($0) > max && $0 !~ /https?:\/\// {
			printf "%d:%d:%s\n", FNR, length($0), $0
		}
	' "$f")

	if [ -n "$long_lines" ]; then
		echo "[pre-commit] [ERROR] ${f} has lines over ${max_cols} chars:" >&2
		printf '%s\n' "$long_lines" | sed 's/^/  /' >&2
		bad=1
	fi
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if [ "$bad" -ne 0 ]; then
	exit 1
fi
