# 080 CI/CD pipeline hardening + PR previews

Status: implemented (pending-review)

## Context

Pre-080 gaps in `.github/workflows/`:

- `deploy.yml` ran on push to main in parallel with CI -> a red build
  could still ship, and deploy rebuilt from scratch instead of shipping
  the artifact CI tested.
- No concurrency group on CI -> stale PR runs burned minutes.
- No `timeout-minutes` anywhere; actions pinned to major tags only;
  `persist-credentials` left on default.
- Node 24 pinned only inside workflow YAML (no `.nvmrc`, no `engines`).
- Conventional Commits enforced only by local hooks; squash-merge
  subjects come from PR titles, which nothing validated (drift already
  on main, e.g. `078 (take 2): ...`).
- No PR preview deploys; no lint coverage for workflow files.

## Change

- `ci.yml` is now the single pipeline: `ci` job (unchanged verify:ci
  gate) uploads `dist/` as artifact; `deploy` (main/dispatch) and
  `preview` (PRs) jobs need a green `ci` and publish that exact
  artifact via `cloudflare/wrangler-action`. `deploy.yml` deleted.
- `preview` publishes to the `cart-game` Pages project under the PR
  head branch and upserts one sticky PR comment (hidden-marker match)
  with the preview URL. Skipped for fork/Dependabot PRs (no secrets).
  Branch name reaches the shell via step env, not `${{ }}` in the
  command, so hostile ref names cannot inject.
- `pr-title.yml` runs `.githook/commit-msg` against the PR title on
  opened/edited/synchronize/reopened -> squash subjects obey the same
  Conventional Commits rules as local commits; zero duplicated logic.
- `actionlint` job (PR-only, docker image pinned by digest) lints
  workflow files.
- Workflow concurrency: PR runs cancel superseded ones; main queues.
  Deploy queues instead of cancelling in-flight publishes.
- All actions pinned to commit SHAs with version comments (Dependabot
  keeps updating SHA pins). `timeout-minutes` on every job.
- Node single-sourced: `.nvmrc` (24) + `engines` in `package.json`;
  workflows use `node-version-file`.

## Review notes

- PR titles in bare backlog-index style (`080: ...`) now fail the
  title check; use `feat: 080 ...` / `docs(backlog): ...` style.
- Preview/deploy use existing `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` secrets; no new secrets.
- Docs-only pushes run the documentation gate only; they do not build `dist`
  or deploy to Pages.

## Verification

- actionlint 1.7.12 clean on all workflows.
- `.githook/commit-msg` fed sample titles: conventional + dependabot
  styles pass; `078 (take 2): ...` and vague `fix: update` fail.
- End-to-end preview + sticky comment observed on the 080 PR itself;
  deploy path exercised on merge to main.
