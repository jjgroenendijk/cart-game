---
type: Convention
title: Cloud Dev Environment
description: Setup script and attribution config for Claude Code and Codex cloud sessions.
tags: [cloud, setup, tooling, git, workflow]
timestamp: 2026-07-12T00:00:00Z
---

# Cloud Dev Environment

How a fresh cloud session (Claude Code on the web, or Codex cloud) becomes a
working game-cart checkout, and how agent attribution is kept out of commits
and PRs.

## Setup script

`tools/setup-cloud.sh` is the single, agent-neutral entrypoint. It is
idempotent and non-interactive, so it is safe as a provider setup-script
field, or run by hand. Steps:

1. Node: read `.nvmrc` and install/select that major via nvm. Cloud images
   ship Node 20/21/22, but this repo needs >=24 (`package.json` engines), so
   the script closes that gap. Without nvm it warns and uses the ambient node.
2. Dependencies: `npm install` (not `npm ci`) so the cloud filesystem snapshot
   is reused incrementally across sessions.
3. Git hooks: `git config core.hooksPath .githook` plus `chmod +x`, mirroring
   `npm run setup`, so pre-commit/pre-push/commit-msg gates run in-session.
4. Attribution backstop: in cloud sessions only (`CLAUDE_CODE_REMOTE=true`),
   merge an empty `attribution` block into the Claude user settings so no agent
   byline is ever written. Skipped locally so it never rewrites a developer's
   global config; the repo setting (below) already covers local runs.

### Wiring it in provider UIs

Each provider runs its own setup-script field before the agent launches. Point
both at the same repo script so behavior stays identical:

```bash
#!/bin/bash
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo cart-game)"
echo "Running from: $(pwd)"
bash tools/setup-cloud.sh
```

The setup script itself also resolves the repo root, so the outer `cd` is
belt-and-suspenders. Setup output is cached: a provider snapshots the
filesystem after the script completes and reuses it, so installs do not repeat
each session. Keep total runtime under ~5 minutes so the cache can build.

## Disabling agent attribution

Claude Code can be told to omit its byline from commits and PR bodies via the
`attribution` setting, committed to the repo at `.claude/settings.json` so it
applies in every cloud and local session:

```json
{
  "attribution": {
    "commit": "",
    "pr": "",
    "sessionUrl": false
  }
}
```

- `commit`: empty string removes the trailing byline from commit messages.
- `pr`: empty string removes the byline from PR bodies.
- `sessionUrl`: `false` omits the `Claude-Session:` commit trailer and the
  session link in PR bodies (v2.1.182+).

The deprecated `includeCoAuthoredBy: false` predates `attribution`; do not set
both. `tools/setup-cloud.sh` writes the same block into the Claude user
settings in cloud sessions, so attribution is off even if the repo settings are
not loaded. This is defense in depth in three layers: the setting stops the
byline from ever being written, the cloud script repeats it at user scope, and
the `commit-msg` hook rejects `Co-authored-by`/`Generated-by`/`Assisted-by`/
`Model` trailers regardless of agent. CLAUDE.md forbids AI attribution too.

## Related

- [commit-style](/conventions/commit-style.md) - Conventional Commits + trailer rules
- [quality-gate](/conventions/quality-gate.md) - Hooks, verify modes, tooling
