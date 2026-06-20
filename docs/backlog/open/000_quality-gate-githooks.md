# 000 Git hooks: strict lint, format, size & line limits

Status: open (full plan — ready for execution; concept refined 2026-06-20)

## Context
AGENTS.md mandates strict linting + auto-formatting per language, enforced
via pre-commit hooks in `.githook/` wired through `git config core.hooksPath`.
Today none of it exists: package.json has only `typecheck` (package.json:11);
no `.githook/` dir, no lint/format/test scripts, core.hooksPath unset.

Ownership: 001 previously bundled the harness as its commit 1 + Config
section. Tooling is foundational + orthogonal to graphics -> must not live in
a feature task. 000 owns the quality gate; 001 consumes it.

## Goal
`.githook/` (dispatcher + per-concern fragments) enforced on every commit,
plus supporting tooling + npm scripts so hooks just invoke them. Covers ALL
repo languages (ts/js/md/json/yml/html + the shell hooks):
- strict lint across all languages (fail on any error)
- max line length (prettier printWidth 100)
- max lines/file (LOC cap 600)
- auto-format of edited (staged) files, re-staged to avoid drift
- Conventional Commits enforcement (commit-msg)
- zero-asset / binary guard (no committed media/binaries)
- secrets guard (secretlint)

## Decided (resolved at refinement)
- printWidth 100; proseWrap preserve (avoids md reflow churn + merge
  conflicts on prose/tables/lists)
- hook arch: plain shell, zero-dep. `.githook/pre-commit` dispatcher runs
  `pre-commit.d/*.sh` in lexical order, exits non-zero on first failure.
  `01-format.sh` does `prettier --write` (on staged files) then `git add`
  them -> kills index/working-tree drift risk
- baseline: one-shot format+lint cleanup commit. Codebase tiny (12 ts, biggest
  310 LOC) -> strict rules apply everywhere with zero legacy debt
- `.githook/*` shell: shellcheck (lint) + shfmt (format). System deps
  (brew install shellcheck shfmt); documented in README setup
- secrets: secretlint (@secretlint/cli + @secretlint/secretlint-rule-preset-
  recommend), config `.secretlintrc.json`. Smarter than hand-rolled regex
  (entropy + known patterns), worth the devDep
- vitest + tools/vitest.config.ts ship here (000 owns the harness).
  `04-test.sh` skips gracefully (exit 0) when no *.test.ts exist -> 001-006
  add tests against the harness 000 provides
- npm run setup -> `git config core.hooksPath .githook` (hooks local-only;
  solves clone gotcha). Documented in README

## Deferred (later iteration, not v1)
- max-fn-lines (no huge fn today; 600 file cap bounds size meanwhile)
- no-console/debugger guard
- large-file (> N MB) guard
- pre-push full vitest suite (no tests yet; add when suite grows)

## Language coverage
Repo file types (git ls-files): .ts (12), .md (17), .json (3), .yml (1),
.html (1), .gitignore. Lint + format cover ALL:
- TypeScript/JS — eslint (lint) + prettier (format)
- Markdown — prettier (format, proseWrap preserve) + markdownlint-cli2 (lint)
- JSON/YAML/HTML — prettier (format)
- Shell (.githook/*) — shellcheck (lint) + shfmt (format)

One prettier config (tools/.prettierrc) formats ts/js/md/json/yml/html in a
single pass. ESLint flat config ts/js-focused.

## Checks (in scope)
- Strict lint — eslint flat (ts/js) + markdownlint (md) + shellcheck (.githook)
- Max line length — prettier printWidth 100 across all languages, NOT eslint
  max-len (fights prettier); eslint-config-prettier disables conflicts
- Max LOC/file — eslint max-lines ["error",600]
- AGENTS.md + dir governance — root AGENTS.md capped 200 LOC; on overflow,
  split detail into a nested AGENTS.md in the relevant child dir. Any dir
  exceeding 5000 LOC must be described in (root or nested) AGENTS.md
- AGENTS.md refresh cadence — once cumulative LOC change since the last
  AGENTS.md-touching commit crosses 1000 LOC, the commit MUST also touch
  AGENTS.md (else pre-commit fails). Counter resets on each AGENTS.md edit
- Auto-format edited files — prettier --write (+ shfmt -w / markdownlint --fix
  where used) on staged files, then re-stage (git add)
- Conventional Commits — commit-msg regex: type from AGENTS.md allowed list
  (feat fix docs refactor test perf build ci chore style revert), imperative
  subject ~50 chars, allow type(scope)! form + merge/revert default msgs
- Zero-asset/binary guard — reject staged NEW asset ext (mp3 wav ogg flac
  png jpg jpeg glb fbx bin webp gif ttf otf woff woff2); upholds procedural /
  no-asset philosophy (005 zero-audio; repo ships no binaries today)
- Secrets guard — secretlint on staged content (API keys/tokens/private keys)

## Architecture (new)
```
.githook/
  pre-commit          # executable dispatcher: runs pre-commit.d/*.sh in
                      #   lexical order, exits non-zero on first failure.
                      #   (a file, not a dir — git calls it as one file)
  pre-commit.d/
    01-format.sh       # prettier --write (+ shfmt -w) on staged files + git add
    02-lint.sh         # eslint (ts/js) + markdownlint (md) + shellcheck (.githook)
    03-typecheck.sh    # tsc --noEmit
    04-test.sh         # vitest run (skip gracefully if no *.test.ts)
    05-assets-guard.sh # reject binary/asset files (zero-asset)
    06-secrets-guard.sh# secretlint on staged content
    07-governance.sh   # AGENTS.md <= 200 LOC (wc -l); flag dir > 5000 LOC
                      #   w/o an AGENTS.md mention (advisory — see Risks);
                      #   require AGENTS.md touch every 1000 LOC of cumulative
                      #   change (counter in state/loc-since-agents, gitignored)
  state/               # gitignored hook working state (loc-since-agents counter)
  commit-msg           # regex-enforce Conventional Commits
tools/
  eslint.config.js     # flat config; strict; max-lines 600; ts/js
  .prettierrc          # printWidth 100; proseWrap preserve; formats ts/js/md/json/yml/html
  .prettierignore      # dist/ node_modules/ package-lock.json
  .markdownlint.json   # md lint rule subset
  .secretlintrc.json   # secretlint preset-recommend
  vitest.config.ts     # include src/**/*.test.ts; jsdom env
```
Wired via `git config core.hooksPath .githook` (npm run setup + README).

[INFO] Fragments live in `pre-commit.d/`, not `pre-commit/`: stock git with
core.hooksPath=.githook calls `.githook/pre-commit` as an executable file,
and a file + directory cannot share the name `pre-commit`. The `.d`
convention keeps per-concern scripts split while the dispatcher satisfies
git's single-file hook entry.

[INFO] Hooks prepend node_modules/.bin to PATH so eslint/prettier/vitest/
secretlint resolve without global installs.

## Commits (execution — each atomic + green: typecheck + lint green)
1. build(tools): add prettier + eslint flat + markdownlint configs
   - tools/.prettierrc (printWidth 100, proseWrap preserve, tabWidth 2),
     tools/.prettierignore (dist node_modules package-lock.json),
     tools/eslint.config.js (flat, strict, max-lines 600, eslint-config-
     prettier), tools/.markdownlint.json (rule subset)
   - package.json devDeps (prettier eslint @eslint/js typescript-eslint
     eslint-config-prettier markdownlint-cli2) + scripts (lint format lint:fix
     format:write); npm install
   - gate: npm run lint green (after baseline, commit 5)
2. build(tools): add vitest + config
   - vitest devDep; tools/vitest.config.ts (include src/**/*.test.ts, jsdom);
     test script; 04-test.sh fragment ready (skip if no tests)
3. build(tools): add secretlint + config
   - @secretlint/cli + @secretlint/secretlint-rule-preset-recommend devDeps;
     .secretlintrc.json; 06-secrets-guard.sh fragment
4. build(githooks): add .githook dispatcher + fragments + setup script
   - .githook/pre-commit (dispatcher) + pre-commit.d/{01-format,02-lint,
     03-typecheck,04-test,05-assets-guard,06-secrets-guard,07-governance}.sh;
     .githook/commit-msg; shellcheck + shfmt clean on all .githook/*
   - npm run setup -> git config core.hooksPath .githook; README setup section
     (brew install shellcheck shfmt note)
   - gate: commit a bad-msg commit -> rejected; stage a .png -> rejected
5. style(repo): one-shot format + lint baseline cleanup
   - npm run format:write + lint:fix repo-wide; commit churn; strict rules
     pass everywhere after
6. docs: this plan-promotion commit (now)

## Risks / gotchas
- Auto-format re-staging: format staged files but skip re-git-add -> index
  keeps unformatted bytes while working tree formatted -> silent drift.
  Mitigation: 01-format.sh git-add after --write (decided)
- eslint max-len vs prettier conflict -> printWidth + eslint-config-prettier,
  NOT both (decided)
- Type-aware eslint (parserOptions.project) slower -> scope to changed files
  or accept cost (decide at exec; default off for v1 speed)
- Markdown auto-format churn -> proseWrap: preserve (decided)
- Conventional-commits regex: match AGENTS.md grammar exactly, allow
  type(scope)! + merge/revert default messages
- Hooks local-only -> npm run setup + README docs (decided)
- shellcheck/shfmt are brew system deps -> README prerequisites; if absent,
  02-lint warns rather than fails? (decide at exec: fail — require them)
- Dir > 5000 LOC -> "described in AGENTS.md" is not cleanly machine-verifiable
  (no check for "is described"). Mitigation: 07-governance.sh flags dirs
  crossing 5000 LOC w/o an AGENTS.md mention (grep); human confirms coverage.
  The 200 LOC AGENTS.md cap IS machine-checked (wc -l) -> fails on overflow
- Refresh-cadence counter needs a persistent state file (gitignored ->
  per-clone, not shared). Trade-off vs git-notes (shared, travels w/ repo)
  decided at exec; state file simpler. Counting net new LOC (not gross churn)
  avoids reformat-only commits forcing a doc touch. Amend/squash rewrites can
  desync counter from history -> acceptable (counter is a nudge, not a ledger)

## Acceptance
- [ ] .githook/ present + scripts executable; core.hooksPath=.githook after
      npm run setup
- [ ] npm run lint / format / typecheck / test scripts exist + green
- [ ] commit-msg rejects bad subject (non-conv / non-imperative); accepts
      type(scope)! + merge/revert defaults
- [ ] pre-commit rejects staged asset file (.png/.glb); rejects secret via
      secretlint
- [ ] pre-commit formats + re-stages edited files (no drift — verify staged
      bytes == formatted bytes)
- [ ] repo-wide strict lint + format green after baseline cleanup
- [ ] README setup section documents brew deps + npm run setup
- [ ] all languages covered: ts/js/md/json/yml/html + .githook shell
- [ ] 04-test.sh skips cleanly when no *.test.ts (exit 0)
- [ ] root AGENTS.md <= 200 LOC; overflow splits to a nested child AGENTS.md;
      any dir > 5000 LOC documented in AGENTS.md
- [ ] commit crossing 1000 LOC cumulative change since last AGENTS.md touch
      is rejected unless it also touches AGENTS.md; counter resets on touch

## Defaults
- prettier: printWidth 100, proseWrap preserve, tabWidth 2, semi true,
  singleQuote false (match ts default), trailingComma all
- eslint: max-lines ["error",600]; strict ts/js rules; max-len OFF (prettier)
- AGENTS.md governance: root AGENTS.md 200 LOC cap; overflow -> split into a
  nested AGENTS.md in the relevant child dir; any dir > 5000 LOC must be
  described in (root or nested) AGENTS.md
- AGENTS.md refresh cadence: require an AGENTS.md touch every 1000 LOC of
  cumulative change since last AGENTS.md commit; counter = net new LOC
  (added - removed) over staged tracked files; reset on AGENTS.md touch;
  state in .githook/state/loc-since-agents (gitignored)
- markdownlint: MD001/003/009/012/018/024/025/029/031/032/040/041 + no hard
  tabs; line-length OFF (prettier owns)
- vitest: include src/**/*.test.ts; environment jsdom; coverage out of scope
- secretlint: preset-recommend
- asset ext blocklist: mp3 wav ogg flac aac png jpg jpeg webp gif glb fbx bin
  ttf otf woff woff2 mp4 mov
- core.hooksPath: .githook

## Non-goals
- CI / GitHub Actions changes (hook local; CI separate)
- husky/lint-staged/nano-staged (plain shell decided — zero-dep)
- Performance/bundle-size budgets (that is 011)
- Branch protection / server-side rules
- Deferred guards (see Deferred) — max-fn-lines, no-console, large-file,
  pre-push full suite

## Previous implementation
None. package.json ships only typecheck today.

## Depends on
Nothing. Foundational — every other item's "green commit" gate ("per 000
harness") depends on THIS. 001-006 + 007-012 consume the harness 000
provides; their test gates dormant until 000 lands (typecheck-only meanwhile).
