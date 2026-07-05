#!/usr/bin/env bash
# 09-knowledge-freshness: block commits that change src/ without a
# docs/knowledge/*.md touch. Delegates to tools/check-knowledge-sync.sh.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
bash "$root/tools/check-knowledge-sync.sh" --staged
