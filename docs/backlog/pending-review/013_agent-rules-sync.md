# 013 Agent rules sync

Status: pending-review

## Context

Attached agent rules added requirements missing from root repo guidance.

## Goal

- Root `AGENTS.md` states full rule set.
- Root `CLAUDE.md` symlinks to `AGENTS.md`.
- Hook governance checks cheap machine-verifiable AGENTS rules.
- README hook docs match current checks.

## Non-goals

- Rewrite all existing backlog prose to caveman style.
- Add heavy custom lint for every prose rule.

## Acceptance

- [x] `AGENTS.md` has annotated dir tree.
- [x] `AGENTS.md` has Mermaid runtime-flow diagram.
- [x] `CLAUDE.md` symlink exists and points to `AGENTS.md`.
- [x] Governance hook checks AGENTS line cap, Mermaid block, CLAUDE symlink.
- [x] File-limit hook checks 600 lines and 100-char line cap.
- [x] README explains updated governance hook.

## Tests

- Pending: `npm run lint`
- Pending: `npm run typecheck`
- Pending: `npm test`
- Pending: `npm run build`
