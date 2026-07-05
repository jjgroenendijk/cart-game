# Agent Guidelines

## Directory Map

```text
./                       # game-cart root
├── .githook/            # local git hooks
│   └── pre-commit.d/    # hook checks
├── .github/             # GitHub automation
│   └── workflows/       # CI/deploy flows
├── docs/                # backlog and notes
│   ├── backlog/         # task files
│   │   ├── concept/     # concept sketches, pre-refinement
│   │   ├── done/        # reviewed tasks
│   │   ├── open/        # planned tasks
│   │   └── pending-review/ # done, awaiting review
│   └── troubleshooting/ # case logs
├── src/                 # game source; see src/AGENTS.md
└── tools/               # agent, backlog, verify, lint, test config
```

## Runtime Flow

```mermaid
flowchart LR
  main[main.ts] --> rapier[Rapier init]
  rapier --> game[Game]
  game --> terrain[Terrain: chunked mesh + trimesh]
  game --> env[Environment: dressing + biome bias, clouds, water, sky, weather]
  env --> dayCycle[dayCycleState singleton]
  env --> terrain
  game --> input[Input]
  game --> physics[PhysicsWorld]
  game --> field[FieldBuilder: field build/dispose + AI step]
  field --> kart[KartController + rivals: suspension, water buoyancy, life]
  field --> race[Race: manager, AI driver, grid]
  field --> kartVfx[KartVfx: GPU ring buffer, dust/drift/splash/poof]
  kartVfx --> lightUniforms[uAmbient ref]
  kart --> physics
  race --> terrain
  game --> gameAudio[GameAudioDriver: impacts, respawn, music, weather]
  field --> gameAudio
  physics --> gameAudio
  gameAudio --> audio[AudioManager + audioGraph/beeps: buses, voices, wind, music, UI, rivals]
  audio --> webaudio[Web Audio API]
  game --> gameFlow[GameFlow: state + overlays + persistence] --> ui[Overlays, HUD, minimap]
  ui --> menuNav[Menu nav: keyboard arrows + gamepad D-pad/stick]
  game --> renderer[Renderer]
  renderer --> materials[Cel and outline materials]
  renderer --> lod[Kart + terrain LOD + quality tier per render]
  renderer --> canvas[Browser canvas]
  main --> statsHud[StatsHud perf overlay: F3]
```

## AGENTS.md

- Every `AGENTS.md` MUST include annotated dir tree for dirs below it.
- Stop tree at child dir with own `AGENTS.md`; child file owns subtree.
- Each dir with `AGENTS.md` MUST also have `CLAUDE.md` symlink to it.
- Create link with `ln -s AGENTS.md CLAUDE.md`; commit link, never copy.
- Keep each `AGENTS.md` under 250 lines. This repo enforces 200 lines.
- Split dir-specific detail into nested `AGENTS.md` before root grows.
- Every `AGENTS.md` MUST include at least one Mermaid diagram.
- Diagram shows flow or state, not folder layout.
- Refresh `AGENTS.md` after about 1000 LOC change below its dir.

## Agent Workflow

- Start each session with `npm run agent:ctx`; use that before broad discovery.
- Run `npm run agent:changed` before choosing checks.
- Use `npm run agent:state` when handoff/resume needs compact local state.
- Use `npm run agent:pr` for compact PR/check status when branch has PR.
- Use `npm run agent:handoff` before spawning subagents.
- Give subagents compact context plus exact scope.
- Subagents return only: files changed, commands run, failures/fixes, risks.
- Main agent owns final `npm run verify`, commit, push, PR.
- Do not paste raw logs into chat. Use capped output plus log path.
- Hook failures are blockers. Read concise error, fix root cause, rerun
  smallest relevant command, retry.
- Runtime agent files live under ignored `.agent/`; commit helper code only.

## Code Quality

- Enforce rules automatically where possible: hooks first, CI as backstop.
- Every language MUST have strict lint plus auto-format. Markdown included.
- Hooks live in `.githook/`; commits fail on lint or unformatted code.
- Configure git via `npm run setup` or `git config core.hooksPath .githook`.
- No hand-written file may exceed 600 lines.
- Generated, vendored, lock, minified, snapshot files exempt from 600-line cap.
- Keep every hand-written line to 100 chars.
- Generated and vendored files exempt from 100-char line cap.
- Only unbreakable URLs, hashes, and similar tokens may exceed 100 chars.
- Treat linter warnings as errors. Fix root cause.
- Inline suppressions need rule code plus reason comment.
- CI (`.github/workflows/ci.yml`) runs format -> typecheck -> lint ->
  lint:secrets -> test -> build -> lint:repo on PR/main, Node 24.
- `npm run verify` mirrors CI. `npm run verify:push` is the pre-push gate.
- `npm run verify:changed` picks cheaper checks from changed files.
- Dependabot (`.github/dependabot.yml`) opens one PR per dep, weekly
  Monday, `chore(deps)` prefix. Patch updates auto-merge once CI passes
  (`.github/workflows/dependabot-automerge.yml`; needs repo "Allow
  auto-merge" ON).

## Commits

- Every change must be committed.
- Make one atomic change per commit.
- Each commit must leave build, lint, tests green.
- Do not mix refactors with behavior changes.
- Do not mix formatting with functional changes.
- Subject uses Conventional Commits: `type(scope?): subject`.
- Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`,
  `build`, `ci`, `chore`, `style`, `revert`.
- Subject uses imperative mood, about 50 chars, no period.
- Non-trivial commit body needs sections:
  `Context`, `Change`, `Rationale`, `Impact/Risk`, `Tests`.
- Body explains what and why, not how. Wrap around 72 chars.
- Breaking changes use `type(scope)!:` or `BREAKING CHANGE:` footer.
- Link issues via `Fixes #123` or `Refs #123`.
- If no issue exists, body must state why.
- No AI attribution trailers. Forbidden: `Co-authored-by:`, `Generated-by:`,
  `AI-Generated-by:`, `Assisted-by:`, `Model:`.
- Allowed trailers: `Fixes`, `Refs`, `BREAKING CHANGE`, `Signed-off-by`
  from human only.

## Git Workflow

- No `WIP` or vague commit messages.
- Checkpoints stay local or on scratch branch until green and reviewable.
- Rebase or squash before PR/merge.
- Run tests before every commit: fast suite or targeted changed-area tests.
- Failing commits are forbidden on shared branches.

## Project Docs

- Tasks live in `docs/backlog/` as `<index>_<task-slug>.md`. Indices are
  globally unique across all backlog dirs; run `backlog:check` after
  numbering (parallel branches can collide on the next free index).
- Backlog dirs are source of truth. `docs/todo.md` is retired; do not
  recreate it.
- Status dirs: `open/` awaits work, `pending-review/` awaits review,
  `done/` holds reviewed tasks.
- `docs/backlog/concept/` holds quick concept stubs. Land new ideas,
  proposed features, and discovered pre-existing issues here first as a
  short `<index>_<slug>.md` sketch; refine into a full plan before work.
- Move task files between dirs as status changes; refine a concept
  stub into a full plan before work (a stub may split into new files).
- Use `npm run backlog:check`, `backlog:list`, or `backlog:next` for
  ambiguous IDs/state checks. Simple known-path `mv` is fine.
- Troubleshooting needs case file in `docs/troubleshooting/<DATE>_<SUBJECT>.md`;
  append steps as work proceeds.

## Repo-Specific Rules

- Zero committed media or binary assets by default; pre-commit rejects
  staged asset/binary extensions.
- Use procedural or code-native visuals/audio unless policy changes.
- Secretlint scans staged content for secrets.
- Static deploy must keep relative asset paths for GitHub Pages
  sub-paths; Vite owns dev/build/preview, keep config minimal.

## Subsystem Invariants (cross-cutting)

- Steering sign: KartController + AiDriver treat positive steer = turn left;
  Input maps left key -> +steer, right key -> -steer (same for gamepad).
- Terrain HeightSource exposes heightAt + colorAt + normalAt; chunks author
  world-consistent normals from normalAt (no per-chunk computeVertexNormals).
  StreamingHeightSource (023): in-bounds SplineFieldCache O(1); out-of-bounds
  TrackGraph, shared heightFromField/colorFromField cores -> seamless.
- Track graph (059): SplineFieldCache bakes {dist,pathY,t,halfWidth,edgeId}
  from TrackGraph; corridor width is per-station -> src/terrain/AGENTS.md.
- Cel terrain normal is per-fragment from a baked world height texture
  (HEIGHT_MAP, NearestFilter, finite-diff), triangulation-independent (021).
- Props: geometry base-at-y=0; origin at raw terrain height; rockRadius(seed)
  shared by visual+collider. DressingChunkManager (023): per-chunk PropFields,
  seed hashSeed(gx,gz) ^ baseSeed.
- CelMaterial outputs LINEAR; any shadow term multiplies diffuse in LINEAR.
  ACES + sRGB applied once by OutputPass.
- Fixed-step accumulator clamps to MAX_STEPS=5 (STEP=1/60; excess dropped).
  Kart visual sync lerps prev->current by acc/STEP; snaps on respawn/teleport.
- Biome bias cascade (025): Environment.update runs DynamicSky -> biome
  skyFogBias lerp (0.2) -> Weather -> channels (054). waterColor -> CelWater
  uTint (white = identity). Temperate = undefined = parity; wildlife [] opts out.
- Registered biomes: temperate/desert/alpine/tundra/tropical (BIOMES; pure
  data, flora PER-CHUNK). Framework + runbook: src/terrain/AGENTS.md.
- Circuits (057): generateCircuit(seed) deterministic 600-1500 m; radii pinned
  by arc construction (floor 12.5); accept = valid AND interesting (anti-oval).
- DynamicSky (042) setElapsed/setDayLength/setFrozen reconfigure w/o rebuild.
- Weather (054) -> src/environment/AGENTS.md: setLevel(k in [0,1]) scales field opacity + fog;
  seeded director drives auto front transitions through zero crossings.
  setWeatherMode rebuilds schedule for race-config preview (no rebuild).
  Channels (dim/wind/wetness) lerp by level; storm dims sky, wets ground
  (uWetness), lightning flashes dayCycleState. Persisted gamecart.weather.v1.

## Writing Style

- Max info density, easy read. Abbrev common prose: DB, auth, config, req,
  res, fn, impl. Strip filler; fragments fine. `X -> Y` for causality.
- Keep code symbols, fn names, API names, error strings verbatim.
- Never use bold unless critical. Headings unnumbered. No emojis.
