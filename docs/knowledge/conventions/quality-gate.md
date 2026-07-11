---
type: Convention
title: Quality Gate
description: Pre-commit hooks, verify modes, lint/format tooling, governance invariants.
tags: [tooling, convention, ci, hooks]
timestamp: 2026-07-11T00:00:00Z
---

# Quality Gate

Pre-commit hooks + `verify.mjs` enforce format, lint, typecheck, tests,
asset/secrets guards, and AGENTS.md governance on every commit.

## Wiring

`npm run setup` -> `git config core.hooksPath .githook`. Hooks are
local-only; run once after clone.

System deps: shellcheck + shfmt (brew) for shell lint/format, run via
`lint:shell` (`tools/check-shell.sh`) as part of the `lint` chain.

## Pre-commit flow

```text
pre-commit (dispatcher)
  -> 01-format.sh     prettier --write + shfmt -w on staged files, re-staged
  -> verify.mjs staged  typecheck + lint + test on staged files only
  -> 05-assets-guard   reject staged binary/asset extensions
  -> 06-secrets-guard  secretlint on staged content
  -> 07-governance     AGENTS.md <= 200 LOC, CLAUDE.md symlink, Mermaid block
  -> 08-file-limits    hand-written files <= 600 lines, <= 100 chars/line
  -> 09-knowledge-sync src/ changes require a docs/knowledge/ touch
commit-msg               Conventional Commits regex enforcement
```

Fragments live in `.githook/pre-commit.d/` (`.d` convention — git calls
`.githook/pre-commit` as a single executable file, so a dir cannot share
the name). Hooks prepend `node_modules/.bin` to PATH.

## Verify modes (`tools/verify.mjs`)

| Mode    | npm script       | Scope                                                         |
| ------- | ---------------- | ------------------------------------------------------------- |
| full    | `verify`         | format, typecheck, lint, lint:secrets, test, build, lint:repo |
| staged  | `verify:staged`  | changed-file subset of full gate on staged files              |
| changed | `verify:changed` | changed-file subset (HEAD diff + untracked)                   |
| push    | `verify:push`    | pre-push; full for src, lighter for docs-only                 |
| ci      | `verify:ci`      | CI gate; uses PR base/head or event SHAs                      |

Changed-file selection: docs-only -> format + lint:md; src/test present
-> typecheck + lint + test; tooling present -> lint:repo; knowledge docs
-> lint:okf; non-docs -> lint:secrets.

## Tooling configs (`tools/`)

| Config               | Tool         | Key settings                                      |
| -------------------- | ------------ | ------------------------------------------------- |
| `eslint.config.js`   | ESLint flat  | max-lines 600, strict ts/js                       |
| `.prettierrc`        | Prettier     | printWidth 100, proseWrap preserve, tabWidth 2    |
| `.markdownlint.json` | markdownlint | MD001/003/009/012/018/024/025/029/031/032/040/041 |
| `.secretlintrc.json` | secretlint   | preset-recommend (v13 `id` form)                  |
| `vitest.config.ts`   | Vitest       | jsdom env, src/**/*.test.ts                       |

## Governance invariants

- Root `AGENTS.md` <= 200 LOC; overflow splits to nested `AGENTS.md`.
- Every dir with `AGENTS.md` has a `CLAUDE.md` symlink to it.
- Every `AGENTS.md` has >= 1 Mermaid diagram.
- Hand-written files <= 600 lines; every line <= 100 chars.
- Zero committed media/binary (pre-commit rejects asset extensions).
- Secrets guard via secretlint.
- src/ changes require a `docs/knowledge/` touch in the same commit.

## CI (`.github/workflows/ci.yml`)

Mirrors `verify` gate: format -> typecheck -> lint (eslint + md + okf +
shell) -> lint:secrets -> test -> build -> lint:repo. PRs add actionlint + PR-title check. Node
version pinned via `.nvmrc`. Actions SHA-pinned. Every job has
`timeout-minutes`.

### Artifact-based deploy/preview

`ci` builds `dist/` and uploads it as an artifact. `deploy` (main) and
`preview` (PR) both `needs: ci`, download the tested artifact, and
publish via `cloudflare/wrangler-action` — no rebuild, so deploy ships
exactly what CI tested. Preview publishes under the PR head branch to
`cart-game`, posts a sticky comment (hidden-marker match), and skips
forks/Dependabot.

### Concurrency

PR runs cancel superseded runs; main queues; deploy queues
(`cancel-in-progress: false`) to avoid clobbering in-flight publishes.

### Auxiliary workflows

- `pr-title.yml` runs `.githook/commit-msg` on PR events — zero
  duplicated logic; squash subjects come from the PR title.
- `dependabot-automerge.yml` auto-merges patch-level Deps PRs on green
  CI (repo "Allow auto-merge" must be ON).

## Defaults

- prettier: printWidth 100, proseWrap preserve, tabWidth 2, semi true,
  singleQuote false, trailingComma all
- eslint: max-lines 600, max-len OFF (prettier owns)
- asset blocklist: mp3 wav ogg flac aac png jpg jpeg webp gif glb fbx
  bin ttf otf woff woff2 mp4 mov
- core.hooksPath: .githook

## Related

- [commit-style](/conventions/commit-style.md)
