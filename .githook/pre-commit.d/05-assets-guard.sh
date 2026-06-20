#!/usr/bin/env bash
# 05-assets-guard: reject staged NEW asset/binary files (zero-asset policy).
set -euo pipefail

bad=0
list=""
while IFS= read -r -d '' f; do
	case "$(basename "$f")" in
	*.mp3 | *.wav | *.ogg | *.flac | *.aac | \
		*.png | *.jpg | *.jpeg | *.webp | *.gif | \
		*.glb | *.fbx | *.bin | \
		*.ttf | *.otf | *.woff | *.woff2 | \
		*.mp4 | *.mov)
		bad=1
		list="${list}
  ${f}"
		;;
	esac
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if [ "$bad" -eq 1 ]; then
	echo "[pre-commit] [ERROR] staged asset/binary files rejected (zero-asset policy):" >&2
	echo "$list" >&2
	echo "Remove the asset or 'git reset -- <file>' before committing." >&2
	exit 1
fi
