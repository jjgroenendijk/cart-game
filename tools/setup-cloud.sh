#!/usr/bin/env bash
# setup-cloud: prepare a cloud (or local) dev session for game-cart.
# Agent-neutral entrypoint shared by Claude Code and Codex cloud environments:
# point each provider's setup-script field at `bash tools/setup-cloud.sh`.
# Idempotent + non-interactive: also safe to run by hand.
#
# Steps:
#   1. Node: match .nvmrc via nvm. Cloud images ship Node 20/21/22, but this
#      repo needs >=24 (see package.json engines), so install/select it here.
#   2. Dependencies: npm install (cache-friendly vs npm ci; the cloud snapshots
#      the filesystem after the setup script, so installs carry across sessions).
#   3. Git hooks: point git at .githook and mark the dispatchers executable,
#      mirroring `npm run setup`.
# See docs/knowledge/conventions/cloud-environment.md
set -euo pipefail

log() { printf '[cloud-setup] %s\n' "$*"; }

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# 1. Node version. Prefer nvm (present in cloud images); fall back to the
#    ambient runtime and warn when it is older than the pinned major.
want_node="$(tr -dc '0-9' <.nvmrc 2>/dev/null || true)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
	# shellcheck disable=SC1091 # nvm.sh path is resolved at runtime
	. "$NVM_DIR/nvm.sh"
	log "nvm: installing Node from .nvmrc (${want_node:-default})"
	nvm install >/dev/null
	nvm use >/dev/null
	if [ -n "$want_node" ]; then
		nvm alias default "$want_node" >/dev/null 2>&1 || true
	fi
	# Persist the resolved bin dir for later session shells; CLAUDE_ENV_FILE is
	# provided when this runs as a SessionStart hook.
	if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
		node_bin="$(dirname "$(command -v node)")"
		# shellcheck disable=SC2016 # literal $PATH is expanded when env file loads
		printf 'export PATH="%s:$PATH"\n' "$node_bin" >>"$CLAUDE_ENV_FILE"
	fi
else
	log "nvm not found; using ambient node $(node --version 2>/dev/null || echo none)"
fi

have_major="$(node --version 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
if [ -n "$want_node" ] && [ -n "$have_major" ] && [ "$have_major" -lt "$want_node" ]; then
	log "WARNING: node ${have_major} < required ${want_node}; build/tests may fail"
fi

# 2. Dependencies.
log "installing npm dependencies"
npm install --no-audit --no-fund

# 3. Git hooks (same as `npm run setup`).
log "configuring git hooks -> .githook"
git config core.hooksPath .githook
chmod +x .githook/pre-commit .githook/pre-push .githook/commit-msg \
	.githook/pre-commit.d/*.sh 2>/dev/null || true

log "done: node $(node --version 2>/dev/null || echo '?'), hooks -> .githook"
