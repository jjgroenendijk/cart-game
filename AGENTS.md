# Agent Guidelines

## Commits

- Every change must be committed.
- Group changes logically; make one atomic change per commit. Each commit should represent a single, self-contained unit of work (e.g. one bugfix or one feature) and leave the build in a working state.

## Linting & Formatting

Every language MUST have very strict linting and automatic formatting configured.
Enforce lint and format via pre-commit hooks in `.githook/`. Hooks must fail the commit on any lint error or unformatted code. Configure git to use `.githook/` via `core.hooksPath` (see README).

## Git Commits

Each commit must contain one logical change only. Do not mix unrelated changes, refactors with behavior changes, or formatting with functional changes. Each commit must be independently checkable and in working state.
Required Commit Body Sections for non-trivial commits:

- Context: What problem/need triggered this
- Change: High-level summary of what changed
- Rationale: Why this approach, trade-offs, alternatives rejected
- Impact/Risk: Behavior changes, migrations, compatibility, performance
- Tests: Exact command(s) run (e.g., `Tests: cd src && uv run pytest tests/`)
  Subject: imperative mood ("add", "fix"), ~50 chars, no period.

Body: blank line after subject, explain what/why (not how), wrap ~72 chars. Body required for non-trivial changes.
Use Conventional Commits format: `type(scope?): subject`

Allowed types: `feat, fix, docs, refactor, test, perf, build, ci, chore, style, revert`

Breaking changes: use `type(scope)!: subject` OR `BREAKING CHANGE: ...` footer with migration steps.
Link issues via footer: `Fixes #123` or `Refs #123`. If no issue exists, body must clearly state the why.
MUST NOT add author/co-author attribution trailers for AI. Forbidden: `Co-authored-by:`, `Generated-by:`, `AI-Generated-by:`, `Assisted-by:`, `Model:`. Allowed trailers: `Fixes #...`, `Refs #...`, `BREAKING CHANGE:...`, `Signed-off-by:` (human only).

## Git Workflow

Commit in small increments, but no meaningless micro-commits. "WIP"/vague messages forbidden. Checkpoints must stay local or on a scratch branch until green and reviewable. Rebase/squash before PR/merge.
MUST run tests before every commit (minimum: fast suite or targeted tests for changed area). EACH COMMIT MUST KEEP REPO GREEN: build passes, tests pass. Failing commits are forbidden on shared branches. Intermediate failing steps must stay local and be squashed before PR/merge.

## Project Docs

Tasks are tracked as markdown files in `docs/backlog/` with the naming convention `<index>_<task-slug>.md`:

- `docs/backlog/open/` - Open tasks awaiting work
- `docs/backlog/pending-review/` - Completed tasks awaiting review
- `docs/backlog/done/` - Completed and reviewed tasks

Move task files between directories as their status changes.
Use `docs/todo.md` to track work: `- [ ]` open, `- [~]` in progress, `- [x]` done.
ALWAYS keep track of troubleshooting progress in a troubleshooting case file in docs/troubleshooting/<DATE>_<SUBJECT>.md.
While troubleshooting, append the steps taken to the troubleshooting case file. For example, `echo 'pinged 1.1.1.1, ping is ok' >> docs/troubleshooting/<DATE>_<SUBJECT>.md`

## Writing Caveman

Abbreviate common prose words (DB, auth, config, req, res, fn, impl) and strip conjunctions. One word when one word does the job.
Use arrows for causality (X -> Y) instead of spelling out the connective phrasing.
Drop articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), and hedging.
Never abbreviate code symbols, function names, API names, or error strings. Keep those verbatim, even when compressing everything else.
Prefer short synonyms: "big" not "extensive", "fix" not "implement a solution for". Sentence fragments are fine.

## Project conventions

Rendering pipeline lives in `src/core/Renderer.ts` (EffectComposer chain)
and `src/materials/`. Layer numbers: 0 = solid (kart + props, inverted-hull
outline), 1 = terrain/walls (post Sobel outline), 2 = sky (post posterize).
Shared sun/ambient uniforms in `src/materials/lightUniforms.ts` — single
source of truth; Renderer writes once/frame, all materials read by reference.
Custom ShaderMaterials output LINEAR; OutputPass applies ACES + sRGB once.
Tests run under jsdom (no WebGL) — keep WebGL-free pure helpers exported for
unit tests; assert shader source + uniform defaults + RT structure for passes.

Terrain subsystem lives in `src/terrain/`. One shared `heightAt(x,z)` fn
(SplineFieldCache bilinear + simplex hills) feeds BOTH the displaced
PlaneGeometry mesh and the Rapier heightfield collider so physics/visuals
agree by construction — never sample one from the other's raw array.
CelMaterial `vertexColors:true` paints road/grass/rock/sand on layer 1;
vertex color attribute values are sRGB->LINEAR to match ColorManagement.

## Writing Style

Maximize information density, while making text effortless to read
Never use bold formatting in markdown text, unless the info is absolutely critical
Keep markdown and text headings unnumbered
NEVER use emojis anywhere, but rather use [ERROR], [WARNING], [INFO] or something else in brackets
