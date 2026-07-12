#!/usr/bin/env bash
# setup-cloud: prepare a cloud (or local) dev session for game-cart.
# Agent-neutral entrypoint shared by Claude Code and Codex cloud environments:
# point each provider's setup-script field at `bash tools/setup-cloud.sh`.
# Idempotent + non-interactive: also safe to run by hand.
#
# Steps:
#   1. Node: match .nvmrc via nvm when present; otherwise download the official
#      build. Cloud images ship Node 20/21/22 (some without nvm), but this repo
#      needs >=24 (see package.json engines), so install/select it here.
#   2. Dependencies: npm install (cache-friendly vs npm ci; the cloud snapshots
#      the filesystem after the setup script, so installs carry across sessions).
#   3. Git hooks: point git at .githook and mark the dispatchers executable,
#      mirroring `npm run setup`.
#   4. Shell tools: install shellcheck + shfmt via apt so the hook and repo
#      shell-lint gates run in-session (they skip gracefully when absent).
#   5. Attribution: in cloud sessions, disable agent byline/trailers in the
#      Claude user settings so no attribution is ever written (backstop to the
#      repo .claude/settings.json and the commit-msg hook).
# See docs/knowledge/conventions/cloud-environment.md
set -euo pipefail

log() { printf '[cloud-setup] %s\n' "$*"; }

# Merge empty attribution into the Claude user settings. Cloud-only so a local
# `bash tools/setup-cloud.sh` never rewrites a developer's global config; the
# repo .claude/settings.json (higher precedence) already covers local runs.
disable_attribution() {
	[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || return 0
	command -v node >/dev/null 2>&1 || return 0
	dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
	mkdir -p "$dir"
	CLAUDE_SETTINGS="$dir/settings.json" node - <<'NODE'
const fs = require("fs");
const file = process.env.CLAUDE_SETTINGS;
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {}
cfg.attribution = { ...(cfg.attribution || {}), commit: "", pr: "", sessionUrl: false };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
NODE
	log "attribution disabled in $dir/settings.json"
}

# Install an official Node build for the given major into a session-persistent
# prefix and prepend it to PATH. Fallback for images that ship only Node
# 20/21/22 with no nvm (e.g. Claude Code on the web), where the ambient runtime
# is older than the pinned major. Idempotent: reuses a good cached install.
# Prints nothing to stdout except via log(); returns non-zero if it cannot.
install_node_binary() {
	major="$1"
	os="$(uname -s | tr '[:upper:]' '[:lower:]')"
	case "$(uname -m)" in
	x86_64 | amd64) arch=x64 ;;
	aarch64 | arm64) arch=arm64 ;;
	armv7l) arch=armv7l ;;
	*)
		log "unsupported arch $(uname -m); cannot auto-install node"
		return 1
		;;
	esac

	prefix="${XDG_DATA_HOME:-$HOME/.local/share}/game-cart/node${major}"
	if [ -x "$prefix/bin/node" ] &&
		[ "$("$prefix/bin/node" --version | tr -dc '0-9.' | cut -d. -f1)" = "$major" ]; then
		export PATH="$prefix/bin:$PATH"
		log "reusing cached node $(node --version) at $prefix"
		return 0
	fi

	command -v curl >/dev/null 2>&1 || {
		log "curl not found; cannot auto-install node ${major}"
		return 1
	}

	# Resolve the latest patch for the major from the official dist index.
	# The index is JSON ordered newest-first, so the first v<major>.x wins.
	pat="\"version\":\"v${major}\\."
	ver="$(curl -fsSL https://nodejs.org/dist/index.json |
		grep -o "${pat}[0-9.]*\"" | head -n1 |
		sed -E 's/.*"(v[0-9.]+)"/\1/')"
	[ -n "$ver" ] || {
		log "could not resolve latest node ${major}.x from dist index"
		return 1
	}

	url="https://nodejs.org/dist/${ver}/node-${ver}-${os}-${arch}.tar.gz"
	tmp="$(mktemp -d)"
	log "installing node ${ver} (${os}-${arch}) -> $prefix"
	if ! curl -fsSL "$url" -o "$tmp/node.tar.gz"; then
		log "download failed: $url"
		rm -rf "$tmp"
		return 1
	fi
	mkdir -p "$prefix"
	tar -xzf "$tmp/node.tar.gz" -C "$prefix" --strip-components=1
	rm -rf "$tmp"
	export PATH="$prefix/bin:$PATH"
	log "node now $(node --version)"
}

# Install shellcheck + shfmt from the distro repo so the hook and repo
# shell-lint gates run in-session instead of skipping. Best-effort: a non-apt
# image or a failed install is non-fatal and leaves the graceful skips in place
# (CI installs the tools and remains the backstop).
install_shell_tools() {
	command -v shellcheck >/dev/null 2>&1 &&
		command -v shfmt >/dev/null 2>&1 && return 0
	command -v apt-get >/dev/null 2>&1 || {
		log "apt-get not found; leaving shell-lint tools to CI"
		return 0
	}

	pkgs=""
	command -v shellcheck >/dev/null 2>&1 || pkgs="$pkgs shellcheck"
	command -v shfmt >/dev/null 2>&1 || pkgs="$pkgs shfmt"
	[ -n "$pkgs" ] || return 0

	sudo=""
	[ "$(id -u)" -eq 0 ] || sudo="sudo"
	log "installing shell-lint tools via apt:${pkgs}"
	# shellcheck disable=SC2086 # $pkgs and $sudo are intentionally word-split
	if ! $sudo apt-get install -y --no-install-recommends $pkgs >/dev/null 2>&1; then
		$sudo apt-get update >/dev/null 2>&1 || true
		# shellcheck disable=SC2086 # see above
		$sudo apt-get install -y --no-install-recommends $pkgs >/dev/null 2>&1 || true
	fi

	if command -v shellcheck >/dev/null 2>&1 && command -v shfmt >/dev/null 2>&1; then
		log "shell-lint tools ready (shellcheck + shfmt)"
	else
		log "shell-lint tools unavailable; CI remains the backstop"
	fi
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# 1. Node version. Prefer nvm (present in some cloud images); otherwise download
#    the official build when the ambient runtime is older than the pinned major.
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
else
	log "nvm not found; ambient node $(node --version 2>/dev/null || echo none)"
fi

# If the resolved node is still older than the pinned major (or absent), install
# the official build directly. Covers images with only Node 20/21/22 and no nvm.
have_major="$(node --version 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
if [ -n "$want_node" ] && { [ -z "$have_major" ] || [ "$have_major" -lt "$want_node" ]; }; then
	log "node ${have_major:-none} < required ${want_node}; installing Node ${want_node}"
	install_node_binary "$want_node" || true
	have_major="$(node --version 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
fi

# Persist the resolved bin dir for later session shells; CLAUDE_ENV_FILE is
# provided when this runs as a SessionStart hook.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && command -v node >/dev/null 2>&1; then
	node_bin="$(dirname "$(command -v node)")"
	# shellcheck disable=SC2016 # literal $PATH is expanded when env file loads
	printf 'export PATH="%s:$PATH"\n' "$node_bin" >>"$CLAUDE_ENV_FILE"
fi

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

# 4. Shell-lint tools so the hook and repo gates run in-session.
install_shell_tools

# 5. Attribution backstop (cloud only).
disable_attribution

log "done: node $(node --version 2>/dev/null || echo '?'), hooks -> .githook"
