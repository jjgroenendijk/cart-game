#!/usr/bin/env bash
# 07-governance: AGENTS.md <=200 LOC, CLAUDE.md symlink, Mermaid block,
# top-level dir coverage advisory.
set -euo pipefail

agents="AGENTS.md"

# 1. Every tracked AGENTS.md has required peer files/content.
while IFS= read -r agents_file; do
	[ -f "$agents_file" ] || continue

	loc=$(wc -l <"$agents_file" | tr -d ' ')
	if [ "$loc" -gt 200 ]; then
		echo "[pre-commit] [ERROR] ${agents_file} is ${loc} lines (>200)." >&2
		echo "Split detail into a nested child AGENTS.md." >&2
		exit 1
	fi

	if ! grep -q '^```mermaid$' "$agents_file"; then
		echo "[pre-commit] [ERROR] ${agents_file} lacks Mermaid diagram." >&2
		exit 1
	fi

	dir=$(dirname "$agents_file")
	if [ "$dir" = "." ]; then
		claude_file="CLAUDE.md"
	else
		claude_file="${dir}/CLAUDE.md"
	fi

	if [ ! -L "$claude_file" ]; then
		echo "[pre-commit] [ERROR] ${claude_file} must symlink to AGENTS.md." >&2
		exit 1
	fi

	target=$(readlink "$claude_file")
	if [ "$target" != "AGENTS.md" ]; then
		echo "[pre-commit] [ERROR] ${claude_file} points to '${target}', want AGENTS.md." >&2
		exit 1
	fi
done < <(git ls-files '*/AGENTS.md' 'AGENTS.md')

# 2. Advisory: top-level dir >5000 tracked source LOC without an AGENTS.md mention.
while IFS= read -r d; do
	[ -d "$d" ] || continue
	case "$d" in
	node_modules | dist | .githook | .git) continue ;;
	esac
	files=$(git ls-files "$d" | grep -E '\.(ts|js|cjs|mjs|md|json|ya?ml|html|sh)$' || true)
	dloc=0
	if [ -n "$files" ]; then
		dloc=$(printf '%s\n' "$files" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
	fi
	if [ "${dloc:-0}" -gt 5000 ]; then
		if [ ! -f "$d/AGENTS.md" ] && ! grep -rq -- "$d" "$agents" 2>/dev/null; then
			echo "[pre-commit] [WARNING] '$d' is ${dloc} LOC (>5000)" >&2
			echo "but not mentioned in ${agents}. Document root or nested AGENTS.md." >&2
		fi
	fi
done < <(git ls-files | sed 's#/.*##' | sort -u)
