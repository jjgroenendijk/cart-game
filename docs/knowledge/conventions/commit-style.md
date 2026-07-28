---
type: Convention
title: Conventional Commits
description: Commit message format and workflow rules for the game-cart repository.
tags: [git, convention, workflow]
timestamp: 2026-07-28T00:00:00Z
---

# Conventional Commits

Commit message format and workflow rules for the game-cart repository.

## Format

```text
type(scope?): subject
```

### Allowed Types

`feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`,
`style`, `revert`

### Subject Rules

- Imperative mood
- ~50 chars
- No trailing period
- Lowercase first word

## Body

Non-trivial commits require body sections:

- **Context** - What state prompted this change
- **Change** - What was changed
- **Rationale** - Why this approach was chosen
- **Impact/Risk** - Consequences and risk assessment
- **Tests** - Verification performed

Body explains what and why, not how. Wrap around 72 chars. Breaking
changes use `type(scope)!:` or a `BREAKING CHANGE:` footer.

## Workflow

- One atomic change per commit; each leaves build, lint, and tests green.
  No mixing refactors or formatting into behavior changes.
- Start each task on a fresh branch cut from latest `origin/main`
  (`git fetch origin` first).
- Every change ships via a PR; never push to `main` directly.
- Rebase is the only integration strategy; never merge-commit. Rebase onto
  latest `origin/main` and squash before merge (PR titles become squash
  subjects via `pr-title.yml`).
- Checkpoints stay local or on a scratch branch until green and reviewable.
- Link issues with their tracker keyword and issue number; if there is
  none, the body states why.

## Prohibited

- AI attribution trailers (`Co-authored-by:`, `Generated-by:`, `AI-Generated-by:`,
  `Assisted-by:`, `Model:`)
- `WIP` or vague messages

## Related

- [log.md](/log.md)
