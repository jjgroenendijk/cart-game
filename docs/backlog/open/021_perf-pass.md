# 021 Perf pass

Status: open (full plan — ready for execution)

## Context

Profiling pass over renderer, physics, terrain, kart, env, audio. Codebase is
sound: fixed-step sim (`Game.ts:197-214`), shared light uniforms by ref
(`lightUniforms.ts:30-56`), good LOD hysteresis (`kartLod.ts`,
`terrainLod.ts:28-32`). Hotspots cluster in four areas:

1. Render-pass multiplier — scene rasterized ~3x per view + 1 shadow.
2. Per-frame GC churn — pervasive small-object alloc in the fixed-step loop.
3. Terrain/physics O(N) scans + unbounded physics accumulator.
4. Static-object waste — `matrixAutoUpdate` never disabled; LOD re-traverses.

All findings verified against source (file:line below). Targets both desktop
high-FPS (>=120Hz judder) and low-end/mobile (GC jitter, slow-mo spiral).

Dominant cost: per rendered view the composer chain runs `RenderPass` ->
`PostOutlinePass` -> `OutputPass` -> `SkyPosterizePass` (`Renderer.ts:285-298`).
`PostOutline` (`postOutline.ts:165-191`) and `SkyPosterize`
(`skyPosterize.ts:256-282`) each re-render the FULL scene into private RTs
(override-material + layer mask) before their fullscreen composite. 2P
split-screen = 2 views -> ~6 scene renders + 6 quads + 1 shadow/frame.

## Goal

Cut steady-state frame cost on both desktop and mobile by: (a) removing
redundant scene re-renders, (b) zero per-frame heap alloc in the hot loop,
(c) replacing O(N) runtime scans with O(1) lookups, (d) clamping the catch-up
budget, (e) skipping work on static/unchanged state. Each phase measured via
the F3 StatsHud (after fixing its sampling — Phase 0) so gains are visible.

## Non-goals

- Changing the fixed-step `STEP = 1/60` contract (`src/AGENTS.md`).
- Changing `heightAt`/`colorAt`/`SplineFieldCache` height-truth semantics
  (chunks are built from a HeightSource; 019 owns that).
- Web Worker terrain build (019 left the builder pure/worker-able; deferred).
- Huge-map / infinite streaming (follow-on to 019).
- Visual rewrite — this is perf only. `colorAt` aliasing fix (see Risks) is the
  one correctness edit bundled in.

## Phased plan (execution order; gate = typecheck + lint + vitest + hook)

### Phase 0 — observability (do first, enables measuring the rest)

`StatsHud` runs its own rAF (`StatsHud.ts:104-126`) sampling `renderer.info`
(`main.ts:28-34`) at an arbitrary instant. Three resets `info.render` per
`WebGLRenderer.render()`; the HUD captures whichever sub-pass last finished
(often a fullscreen quad = ~2 tris), so the F3 CALLS/TRIS readout underreports
the real ~7 scene renders/frame. Fix before measuring anything.

- `src/core/Renderer.ts` — expose an accumulated per-frame snapshot taken ONCE
  after `renderViews` (sum across passes), reset at frame start.
- `src/ui/StatsHud.ts`, `src/main.ts` — read the accumulated snapshot, not raw
  `renderer.info` from a stray rAF.

### Phase 1 — GC elimination (safe, many small atomic commits)

Pool scratch vectors/arrays across the fixed-step loop. ~hundreds of short-lived
objects/frame today.

- `PhysicsWorld.castRayDown` (`PhysicsWorld.ts:52-69`) — `this.ray.dir = {0,-1,0}`
  is a no-op reset (ray built with that dir, `:30`); drop it. Return a reused
  `RayHit` scratch; caller (`KartController.ts:184`) reads only `toi`.
- `KartController` (`:191-295`) — ~12 fresh `{x,y,z}`/`vmul` literals/kart/step
  (wheel impulses, engine, grip, upright, angvel). Add cached scratch vectors.
  `this.forward.clone().negate()` (`:256`) allocates a Vector3/brake.
- `FieldBuilder.sampleAhead` (`:357-365`) — 16-pt array + 16 objs/rival/step.
  Pre-allocated per-rival `AiSplinePoint[16]` written in place.
- `FieldBuilder.rivalPositions` (`:368-379`) — per-rival array + ~6 objs/step.
  Per-rival reusable buffer.
- Audio-state builders — `humanAudioStates`/`rivalAudioStates`
  (`FieldBuilder.ts:287-317`) + `listenerTransform` (`:333-339`,
  `listenerTransform.ts:55-59`) allocate ~20-30 Vec3/state objs/frame. Pool.
  Also 3x `views.map(...)` builds of the same camera list/frame
  (`Game.ts:234`, `Renderer.ts:350,369`) — build once per `renderViews`.
- `RaceManager.snapshot` (`raceManager.ts:207-216`) — deep-clones 3 structs/frame
  the HUD only reads. Add read-only accessor or reused buffer.
- `dayCycle.computeDayCycle` (`dayCycle.ts:188,197-203`) — `new Vector3` + 5
  `new Color`/frame from a pure-compute path. `lerpKeyColor` already takes an
  `out`; pool the Color outs at the call site.

### Phase 2 — render-pass reduction (highest GPU ROI)

- Share a sampleable `DepthTexture` across composer RTs so `PostOutline` +
  `SkyPosterize` mask passes READ existing depth instead of re-rasterizing the
  scene. Removes 1-2 full scene renders/view. Touches `Renderer.ts:285-298`,
  `postOutline.ts:170-191`, `skyPosterize.ts:262-282`.
- Gate `PostOutline`/`SkyPosterize` when `state !== "racing"` — the full chain
  runs during menu/pause (`Game.ts:227-239`). Skip mask passes on frozen frames.

### Phase 3 — terrain + physics hot paths

- `closestPoint` O(1024) linear scan (`SplineTrack.ts:103-128`) called per kart
  per sub-step (`FieldBuilder.ts:233,343`) AGAINST its own build-time-only
  docstring (`:97-102`). `SplineFieldCache` caches `dist/pathY` but not the `t`
  the AI/race path needs. Add a `t`-valued nearest-point cache (or LUT); route
  runtime callers through it.
- Accumulator never clamped after the sub-step loop (`Game.ts:210-214`): on slow
  devices `acc` grows unbounded -> slow-mo spiral. Add
  `if (this.acc > STEP * MAX_STEPS) this.acc = STEP * MAX_STEPS;` after the loop.
- Terrain trimesh fully rebuilt on LOD tier change (`TerrainChunkManager.ts:
228-236`) — Rapier re-builds the BVH mid-frame. Cheaper: pre-build 3
  bodies/chunk, toggle collision groups/visibility instead of remove/recreate.
- `numSolverIterations = 8` (`PhysicsWorld.ts:27`, 2x default). Profile 8 -> 6;
  ~25% solver saving if suspension stays stable.

### Phase 4 — static-object waste + LOD

- `matrixAutoUpdate` is never disabled anywhere (grep: 0 hits). Terrain chunks,
  merged prop buckets, water plane, sky dome recompute world matrices every
  frame, multiplied across render passes. Set `false` + one-shot
  `updateMatrix()` at build. Candidates: `PropField.ts:216-291`,
  `Water.mesh`, `Renderer.ts:133-142` sky, `TerrainChunkManager` chunk meshes.
- `kartLod.applyKartLodGroup` (`kartLod.ts:106-117`) traverses every kart's full
  child graph (~15+ meshes) every frame with no dirty check, setting props that
  rarely change. Cache `prev` level; skip traverse when unchanged
  (`Renderer.ts:349-361` caller).
- Decor `InstancedMesh` bounding spheres span the whole 200m world -> never
  frustum-culled -> all 4700 decor instances submit every frame
  (`PropField.ts:275`, no `boundingSphere` set). Set explicit bounds or add
  draw-distance cull. 4700 decor `receiveShadow=true` (`:277`) gains little ->
  drop.

### Phase 5 — polish

- Physics->visual interpolation: `sync` ignores `frameAlpha` (`Kart.ts:169`,
  caller passes `1`, `Game.ts:221-222`). Physics runs 60Hz; on 120/144Hz the
  same pose paints 2+ frames -> micro-stutter. Lerp prev vs current body pose
  by `acc/STEP`.
- Shadow: single non-cascaded frustum, full re-render/frame (`quality.ts:50-56`,
  `Renderer.ts:110-111`). CSM + per-object cast-shadow cull. Kart LOD only
  drops shadow at "minimal" band (`kartLod.ts:75`).
- Audio: `updatePlayers`/`updateRivals` run every frame even when silent
  (`Game.ts:240-245`); `VoiceSet.updateEngine` schedules params for muted voices
  (`voiceSet.ts:158-171`). Silence-gate when `!engineActive`. Rival positional
  voices (~54 param writes/frame, `rivalVoices.ts:197-344`) get scheduled
  regardless of distance -> add distance skip.
- `Weather` 1500-particle CPU loop + full position-buffer re-upload/frame
  (`Weather.ts:114-136`). Partial/dirty-range upload or GPU-shader motion.

## Contracts with 000-020

- 011 (LOD + perf budget): this is the measured follow-on. Consumes
  `core/stats.ts`, `quality.ts`, `kartLod`, F3 StatsHud. Phase 0 fixes the
  StatsHud sampling 011 relied on for verification.
- 019 (terrain chunking): Phase 3 trimesh-rebuild fix + Phase 4 chunk
  `matrixAutoUpdate` edit live inside 019's `TerrainChunkManager`. No
  HeightSource/heightAt contract change.
- 008 (split-screen): Phase 2 render-pass reduction directly cuts 2P cost (2x
  the savings vs 1P).
- 009/015 (audio): Phase 1 audio-state pooling + Phase 5 silence-gate edit
  `FieldBuilder` audio builders + `AudioManager`/`rivalVoices` update paths only.
- 001/002 (cel/post): Phase 2 DepthTexture share touches the composer pass
  contract; verify outline/sky-post output is bit-identical (acceptance).
- 000 (harness): every commit gated by typecheck + lint + vitest + hook.
- 020: independent.

## Commits (each atomic + green)

Grouped by phase; each phase's list restarts at 1.

### Phase 0 — observability

1. `perf(stats): sample renderer.info once per game frame after renderViews`
   - accumulated snapshot in `Renderer`; `StatsHud`/`main.ts` read it.

### Phase 1 — GC elimination

1. `perf(physics): pool raycast result + drop redundant ray.dir reset`
2. `perf(kart): cache Rapier impulse scratch vectors`
3. `perf(race): pool AI sampleAhead + rivalPositions buffers`
4. `perf(audio): pool audio-state builders + dedup camera-list builds`
5. `perf(race): reusable RaceManager snapshot accessor`
6. `perf(env): pool computeDayCycle Color/Vector3 outs`

### Phase 2 — render-pass reduction

1. `perf(renderer): share DepthTexture across composer mask passes`
2. `perf(renderer): gate post outline/sky passes when not racing`

### Phase 3 commits — terrain + physics

1. `perf(terrain): O(1) spline t cache; route closestPoint callers via it`
2. `fix(core): clamp physics accumulator to prevent slow-mo spiral`
3. `perf(terrain): toggle pre-built trimesh bodies on LOD change`
4. `perf(physics): lower solver iterations 8 -> 6 (profiled stable)`

### Phase 4 commits — static-object waste + LOD

1. `perf(render): disable matrixAutoUpdate on static scene objects`
2. `perf(kart): skip kartLod traverse when level unchanged`
3. `perf(env): decor bounding spheres + drop decor receiveShadow`

### Phase 5 commits — polish

1. `perf(kart): physics->visual interpolation in sync`
2. `perf(renderer): CSM + per-object cast-shadow cull`
3. `perf(audio): silence-gate inactive voices + rival distance skip`
4. `perf(weather): partial/dirty-range particle buffer upload`
5. `fix(terrain): colorAt aliasing corrupts road/grass blend`

### Docs

1. `docs: add 021 perf pass plan + todo + troubleshooting`
   - this file; mark 021 in `docs/todo.md`; troubleshooting verify case (F3
     readout before vs after per phase; no black screen; judder/GC trace).

## Risks

- DepthTexture share (Phase 2) is the cross-cutting change. Mask passes
  currently clear+re-render into private RTs; reading shared depth must produce
  bit-identical outline/sky-post output. Mitigation: render-output parity test
  (assert shader samplers read the shared depth) + dev-server visual diff.
- Trimesh body toggle (Phase 3 commit 12) changes how collision is enabled —
  verify ray-parity guard (`Terrain.test.ts:65-87`) still passes and karts
  drive gap-free across chunk edges (019 acceptance reused).
- Solver 8 -> 6 (Phase 3 commit 13) may soften suspension/contacts. Profile on
  the 6-kart field; revert to 8 if stacking/jitter regresses. Make it a
  measured decision, not a blind cut.
- Spline `t` cache (Phase 3 commit 10): AI lookahead + race progress depend on
  monotonic `t`; the cache must respect the closed loop. Validate against the
  existing `closestPoint` values before switching callers.
- Interpolation (Phase 5 commit 17): adding prev-pose storage to Kart increases
  per-kart state; verify Kart stays <= 600 lines + no alloc in `sync`.
- `colorAt` aliasing (`heightmap.ts:185-199`): `toLinearScratch` overwrites the
  road color before the grass blend reads it — correctness + redundant work.
  Bundled as the one non-perf fix; may subtly change terrain shading in the
  road/grass band (closer to intended). Call out in PR.
- Strict TS `noUnusedLocals`: all pooled scratch must be used; `_`-prefix unused.
- File budgets: `Renderer.ts` ~380, `Game.ts` ~443-468, `FieldBuilder.ts` ~394,
  `KartController.ts`, `dayCycle.ts` ~307 — all have headroom; re-check before
  each commit that touches a file near the cap.

## Acceptance

- [ ] Phase 0: F3 CALLS/TRIS reflects accumulated per-frame totals (not a stray
      sub-pass); numbers rise/fall predictably with view count + pass toggles.
- [ ] Phase 1: zero per-frame heap alloc in the fixed-step loop (verify via a
      heap-snapshot diff or allocation timeline over a steady racing second);
      no regression in physics/AI behavior.
- [ ] Phase 2: outline + sky-post output bit-identical before/after DepthTexture
      share; 1-2 fewer scene renders/view confirmed in F3; 2P gains ~2x 1P.
- [ ] Phase 3: `closestPoint` no longer in runtime profile; accumulator clamps
      on an artificial stall (no unbounded slow-mo); trimesh tier change no
      longer rebuilds BVH; solver change keeps 6-kart field stable.
- [ ] Phase 4: static objects skip matrix recompute; kartLod traverse skipped
      on unchanged level; decor culls/fades by distance.
- [ ] Phase 5: >60Hz display shows no micro-stutter; shadow cost cut; silent
      audio frames do near-zero param scheduling; weather upload shrinks.
- [ ] `colorAt` blend matches intended road->grass gradient (visual verify).
- [ ] All touched files <= 600 lines + lines <= 100 chars; every commit passes
      `typecheck && lint && test` + hook.
- [ ] Per-phase F3 readout logged in `docs/troubleshooting/`: draw calls / tris
      / frame ms / (alloc count where measurable) before vs after; no black
      screen; 1P + 2P drive gap-free.

## Defaults

- Accumulator clamp: `MAX_STEPS = 5` (current cap), drop leftover beyond that.
- Solver iterations: 6 (profiled; revert path documented).
- Spline `t` cache: reuse `SplineFieldCache` grid resolution (256x256), add a
  `t` field per cell; bilinear lookup like `dist/pathY`.
- Static `matrixAutoUpdate=false` set: terrain chunk meshes, merged prop
  buckets + their outline children, water plane, sky dome. Moving groups
  (clouds, weather, wildlife) keep auto-update.
- Decor draw distance: fog-aligned cull (instances beyond `fogFar` drop).

## Previous implementation

None. Closest patterns + precedents:

- Pure helpers for pooling: `FrameMsEwma` (`stats.ts:65-83`), `lerpKeyColor` out
  arg (`dayCycle.ts:300-306`), `kartLod` band math (`kartLod.ts:56-96`).
- Ray-parity guard to reuse for trimesh-toggle verify: `Terrain.test.ts:65-87`.
- RAPIER.init test stub pattern: `KartController.test.ts:7-11`.
- DepthTexture in a composer: three r0.184 `WebGLRenderTarget` +
  `DepthTexture`; `RenderPass` can share depth via render target config.
- Big-prop merge precedent (visuals merged, colliders per-prop):
  `PropField.ts:216-241`.

## Depends on

000 (harness; test gate live). 011 (LOD + perf budget + F3 StatsHud; Phase 0
fixes its sampling). 019 (terrain chunking; Phase 3 trimesh-toggle + Phase 4
chunk matrix edits live in `TerrainChunkManager`). 001/002 (cel + post; Phase 2
verifies output parity). 008 (split-screen; Phase 2 cuts 2P cost). 009/015
(audio; Phase 1 + 5 audio edits). Independent of 003-007/010/012-018/020.
