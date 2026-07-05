---
type: Convention
title: Conventional Commits
description: Commit message format and workflow rules for the game-cart repository.
tags: [git, convention, workflow]
timestamp: 2026-07-05T00:00:00Z
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

## Prohibited

- AI attribution trailers (`Co-authored-by:`, `Generated-by:`, `AI-Generated-by:`,
  `Assisted-by:`, `Model:`)
- `WIP` or vague messages

## Related

- [log.md](/log.md)
