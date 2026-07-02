#!/usr/bin/env bash
# Full-repo policy checks for CI. Pre-commit fragments cover staged files;
# this script checks tracked files after checkout.
set -euo pipefail

max_lines=600
max_cols=100
bad=0
headroom_threshold=$((max_lines - 50))
headroom=""

echo "[repo-rules] shell scripts"
shellcheck .githook/pre-commit .githook/pre-push .githook/commit-msg \
	.githook/pre-commit.d/*.sh tools/*.sh
shfmt -d -ln bash .githook/pre-commit .githook/pre-push .githook/commit-msg \
	.githook/pre-commit.d/*.sh tools/*.sh

echo "[repo-rules] AGENTS.md files"
while IFS= read -r agents_file; do
	[ -f "$agents_file" ] || continue

	loc=$(wc -l <"$agents_file" | tr -d ' ')
	if [ "$loc" -gt 200 ]; then
		echo "[repo-rules] [ERROR] ${agents_file} is ${loc} lines (>200)." >&2
		bad=1
	fi

	if ! grep -q '^```mermaid$' "$agents_file"; then
		echo "[repo-rules] [ERROR] ${agents_file} lacks Mermaid diagram." >&2
		bad=1
	fi

	dir=$(dirname "$agents_file")
	if [ "$dir" = "." ]; then
		claude_file="CLAUDE.md"
	else
		claude_file="${dir}/CLAUDE.md"
	fi

	if [ ! -L "$claude_file" ]; then
		echo "[repo-rules] [ERROR] ${claude_file} must symlink to AGENTS.md." >&2
		bad=1
		continue
	fi

	target=$(readlink "$claude_file")
	if [ "$target" != "AGENTS.md" ]; then
		echo "[repo-rules] [ERROR] ${claude_file} points to '${target}'." >&2
		bad=1
	fi
done < <(git ls-files '*/AGENTS.md' 'AGENTS.md')

echo "[repo-rules] asset policy"
while IFS= read -r f; do
	case "$(basename "$f")" in
	*.mp3 | *.wav | *.ogg | *.flac | *.aac | \
		*.png | *.jpg | *.jpeg | *.webp | *.gif | \
		*.glb | *.fbx | *.bin | \
		*.ttf | *.otf | *.woff | *.woff2 | \
		*.mp4 | *.mov)
		echo "[repo-rules] [ERROR] tracked asset/binary rejected: ${f}" >&2
		bad=1
		;;
	esac
done < <(git ls-files)

echo "[repo-rules] file limits"
while IFS= read -r f; do
	[ -f "$f" ] || continue
	[ -L "$f" ] && continue

	case "$f" in
	node_modules/* | dist/* | package-lock.json | pnpm-lock.yaml | yarn.lock)
		continue
		;;
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
		echo "[repo-rules] [ERROR] ${f} is ${lines} lines (> ${max_lines})." >&2
		bad=1
	elif [ "$lines" -gt "$headroom_threshold" ]; then
		headroom="${headroom}${lines}"$'\t'"${f}"$'\n'
	fi

	long_lines=$(awk -v max="$max_cols" '
		length($0) > max && $0 !~ /https?:\/\// {
			printf "%d:%d:%s\n", FNR, length($0), $0
		}
	' "$f")

	if [ -n "$long_lines" ]; then
		echo "[repo-rules] [ERROR] ${f} has lines over ${max_cols} chars:" >&2
		printf '%s\n' "$long_lines" | sed 's/^/  /' >&2
		bad=1
	fi
done < <(git ls-files)

echo "[repo-rules] headroom (within 50 lines of ${max_lines}-line cap)"
if [ -z "$headroom" ]; then
	echo "[repo-rules] [INFO] none"
else
	while IFS=$'\t' read -r hl hf; do
		[ -z "$hl" ] && continue
		printf '[repo-rules] [INFO] %s %d (> %d)\n' \
			"$hf" "$hl" "$headroom_threshold"
	done <<<"$headroom"
fi

if [ "$bad" -ne 0 ]; then
	exit 1
fi
