# 000 Git hooks: strict lint, format, size & line limits

Status: open (concept — to be refined; promote to full plan before execution)

## Context
AGENTS.md mandates strict linting + auto-formatting per language, enforced
via pre-commit hooks in `.githook/` wired through `git config core.hooksPath`.
Today none of it exists: package.json has only `typecheck` (`package.json:11`);
no `.githook/` dir, no `lint`/`format`/`test` scripts, `core.hooksPath` unset.

Collision with 001: the cel-shading item currently bundles the whole harness
as its commit 1 (`001:84-92` — vitest+eslint+prettier + the
`.githook/pre-commit` dispatcher + fragments) plus a "Config
(lint/format/tests)" section (`001:57-82`). Tooling is foundational and
orthogonal to graphics; it must not live inside a feature task. 000 takes
ownership of the quality gate; 001's commit 1 + Config section get
dropped/deferred here (follow-up edit to 001, separate atomic change).

## Goal
`.githook/` with a dispatcher + per-concern fragments, enforced on every
commit, plus the supporting tooling + npm scripts so the hooks just invoke
them. Covers ALL repo languages (ts/js/md/json/yml/html + the shell hooks):
- strict lint across all languages (fail on any error)
- max line length (prettier printWidth)
- max lines per file (LOC cap)
- automatic formatting of edited (staged) files
- Conventional Commits enforcement (commit-msg)
- zero-asset / binary guard (no committed media/binaries)
- secrets guard (no committed keys/tokens)

## Language coverage
Repo file types today (`git ls-files`): `.ts` (12), `.md` (16), `.json` (3),
`.yml` (1), `.html` (1), `.gitignore`. Lint + format must cover ALL of them,
not just TypeScript:
- TypeScript / JavaScript — eslint (lint) + prettier (format)
- Markdown — prettier (format) + markdownlint (lint) for docs consistency
- JSON / YAML / HTML — prettier (format)
- Shell (the `.githook/*` scripts themselves) — shellcheck (lint) + shfmt
  (format)

One prettier config (`tools/.prettierrc`) formats ts/js/md/json/yml/html in
a single pass — the clean win. ESLint stays ts/js-focused (markdown code
blocks optional via eslint-plugin-markdown).

## Checks (in scope)
- Strict lint (all languages) — eslint flat config `tools/eslint.config.js`
  (ts/js) + markdownlint (md) + shellcheck (`.githook/*`).
- Max line length — prettier `printWidth` across all languages, NOT eslint
  `max-len` (fights prettier); eslint-config-prettier disables conflicts.
- Max LOC per file — eslint `max-lines` at **600** (decided; see Defaults)
  (+ optional `max-lines-per-function`) for ts/js; md cap TBD at refinement.
- Auto-format edited files — `prettier --write` (+ `shfmt -w` /
  `markdownlint --fix` where used) on staged files, then re-stage (see Risks).
- Conventional Commits — `commit-msg` hook: regex-enforce `type(scope?):`
  with type from the AGENTS.md allowed list (`feat, fix, docs, refactor,
  test, perf, build, ci, chore, style, revert`), imperative subject, ~50 chars.
- Zero-asset / binary guard — reject staged NEW `.mp3/.wav/.ogg/.flac/.png/
  .jpg/.glb/.fbx/...`; upholds the procedural / no-asset philosophy
  (005 zero-audio; repo ships no binary assets today).
- Secrets guard — reject obvious API keys / tokens / private keys in staged
  content (AGENTS.md security requirement).

## Checks (still optional, pick at refinement)
- pre-commit: no `console.log` / `debugger` in `src/` (allowlist ok).
- pre-push: full vitest suite (pre-commit fast/targeted; pre-push runs all
  so red is never pushed).
- pre-commit: large-file guard (reject > N MB files).

## Architecture (sketch)
```
.githook/
  pre-commit          # executable dispatcher: runs pre-commit.d/*.sh in
                      #   lexical order, exits non-zero on first failure.
                      #   (a file, not a dir — git calls it as one file)
  pre-commit.d/
    01-format.sh       # prettier --write (+ shfmt -w) on staged files + git add
    02-lint.sh         # eslint (ts/js) + markdownlint (md) + shellcheck (.githook)
    03-typecheck.sh    # tsc --noEmit
    04-test.sh         # vitest run (fast/targeted)
    05-assets-guard.sh # reject binary/asset files (zero-asset)
    06-secrets-guard.sh# reject secrets
  commit-msg           # regex-enforce Conventional Commits
  pre-push             # full vitest suite (optional — see Checks)
tools/
  eslint.config.js     # flat config; strict; max-lines; ts/js
  .prettierrc          # printWidth; formats ts/js/md/json/yml/html
  .prettierignore
  .markdownlint.json   # md lint rules
  vitest.config.ts
```
Wired via `git config core.hooksPath .githook` (documented in README).

## Defaults (decided so far)
- max lines/file: **600** — eslint `max-lines: ["error", 600]`
- max-fn-lines, printWidth, proseWrap (md), large-file MB: TBD
  (see Needs refinement)

## Non-goals
- CI / GitHub Actions changes (hook is local; CI is separate)
- Adopting `husky`/`lint-staged`/`nano-staged` (decide at refinement — plain
  shell fragments are zero-dep; frameworks handle re-staging cleanly)
- Performance budgets / bundle-size limits (that is 011)
- Branch protection / server-side rules
- Fixing pre-existing legacy code (baseline policy — see Needs refinement)

## Dependencies
Nothing. Foundational — every other item's "green commit" gate
("per 001 harness" / "typecheck-only until 001 lands") actually depends on
THIS, not 001. Promoting 000 out of 001 unblocks the test gate for
003-006/007-012 independently of the cel-shading work.

## Risks / gotchas
- Auto-format re-staging: if the hook formats staged files but does not
  re-`git add` them, the index keeps unformatted bytes while the working
  tree is formatted -> silent drift. Must re-stage after `prettier --write`.
- eslint `max-len` vs prettier conflict -> use printWidth +
  eslint-config-prettier, not both.
- Type-aware eslint (`parserOptions.project`) is slower; scope to changed
  files or accept the cost.
- Legacy files: strict rules repo-wide may flag untouched code. Decide
  baseline policy (fix-on-touch / one-shot cleanup commit / scoped
  overrides) before enabling globally.
- Markdown auto-format churn: prettier reflows prose/tables/list wrapping ->
  large noisy diffs + merge conflicts on docs. Mitigation: `proseWrap:
  preserve` + scope format to changed lines where possible.
- Conventional-commits regex: too strict rejects valid scopes/`!`/merge
  commits; too loose admits junk. Match AGENTS.md grammar exactly, allow
  `type(scope)!: subject` + merge/revert default messages.
- Hooks are local-only -> devs must run `git config core.hooksPath .githook`
  after clone; document in README + consider a `setup` npm script.

## Needs refinement
- Exact caps: max-fn-lines, printWidth (100? 80?), large-file MB threshold
  (if large-file guard adopted). max lines/file = 600 (decided, Defaults).
- Markdown formatting: prettier `proseWrap` (preserve vs always) reflows
  prose/tables/lists — decide; pick the markdownlint rule set
- shfmt + shellcheck: adopt for `.githook/*` shell, or keep hooks trivial
  enough to skip?
- Secrets detection: hand-rolled regex vs a scanner (e.g. secretlint);
  asset-guard extension list final
- Framework vs plain shell (lint-staged re-staging convenience vs zero-dep)
- Baseline policy for pre-existing code (fix-on-touch / one-shot cleanup /
  scoped overrides) — strict rules repo-wide will flag untouched md/ts
- Remaining optional guards (no-console, pre-push full suite, large-file):
  in v1 or later?
- Add a `setup` script that runs `git config core.hooksPath .githook`?
