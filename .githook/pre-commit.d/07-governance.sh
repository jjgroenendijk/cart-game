#!/usr/bin/env bash
# 07-governance: AGENTS.md <=200 LOC (fail); dir >5000 tracked source LOC
# without an AGENTS.md mention (advisory); AGENTS.md refresh every 1000 LOC
# of cumulative net change since the last AGENTS.md-touching commit (fail).
set -euo pipefail

agents="AGENTS.md"

# 1. Root AGENTS.md LOC cap (machine-checked -> fail).
if [ -f "$agents" ]; then
	loc=$(wc -l <"$agents" | tr -d ' ')
	if [ "$loc" -gt 200 ]; then
		echo "[pre-commit] [ERROR] AGENTS.md is ${loc} lines (>200). Split detail into a nested child AGENTS.md." >&2
		exit 1
	fi
fi

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
			echo "[pre-commit] [WARNING] '$d' is ${dloc} LOC (>5000) but not mentioned in ${agents}. Document it (root or nested AGENTS.md)." >&2
		fi
	fi
done < <(git ls-files | sed 's#/.*##' | sort -u)

# 3. AGENTS.md refresh cadence: require a touch every 1000 LOC of net change.
state_dir=".githook/state"
mkdir -p "$state_dir"
counter_file="$state_dir/loc-since-agents"
if [ ! -f "$counter_file" ]; then
	echo 0 >"$counter_file"
fi
prev=$(cat "$counter_file" 2>/dev/null || echo 0)
case "$prev" in
'' | *[!0-9]*) prev=0 ;;
esac

numstat=$(git diff --cached --numstat)
added=$(printf '%s\n' "$numstat" | awk '{a+=($1=="-")?0:$1} END{print a+0}')
removed=$(printf '%s\n' "$numstat" | awk '{r+=($2=="-")?0:$2} END{print r+0}')
delta=$((added - removed))

# Touching AGENTS.md this commit resets the counter.
if git diff --cached --name-only | grep -qx "AGENTS.md"; then
	echo 0 >"$counter_file"
	exit 0
fi

cur=$((prev + delta))
echo "$cur" >"$counter_file"
if [ "$cur" -ge 1000 ]; then
	echo "[pre-commit] [ERROR] cumulative change ${cur} LOC since last AGENTS.md touch (>=1000)." >&2
	echo "Touch AGENTS.md in this commit to reset the counter." >&2
	exit 1
fi
