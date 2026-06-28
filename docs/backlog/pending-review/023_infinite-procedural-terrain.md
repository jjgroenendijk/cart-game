# 023 Infinite procedural terrain (+ wall removal, streaming dressing)

Status: pending-review (Phase A + B implemented; runtime F3 verification pending)

## Context

Today the world is a bounded 200 m square (worldHalf 100). Four things enforce
the bound + a hard wall:

- Boundary wall: `Terrain.ts:137-167` `buildBoundaryWall` (4 cuboid meshes +
  Rapier bodies) + dispose `Terrain.ts:124-135`. User wants it gone.
- `SplineFieldCache` `heightmap.ts:56-109`: a pre-baked bounded grid over
  [-worldHalf, worldHalf]; `query()` clamps at bounds (`:87-90`) -> stale edge
  values beyond. Every `heightAt`/`colorAt` flows through it (`:137-148`).
- `TerrainChunkManager.ts:113-117`: v1 ctor activates ALL chunks over a fixed
  0..gridCount grid (coords non-negative/bounded); `buildHeightTexture`
  (`:247-276`) bakes ONE global height texture over worldSize.
- Dressing bounded to worldHalfExtent 100: `PropField` (`PropField.ts:115-143`,
  `propSampler.ts:78-100`), `Wildlife` (`critters.ts:147-211`), `Clouds`
  (`Clouds.ts:54-69`), `Weather` (`Weather.ts:87-177`), `Water` (`Water.ts:6`).

019 was BUILT for this and explicitly deferred it (`019:64,234`): the
`HeightSource` interface (`heightSource.ts:54-58`) decouples chunks from the
bounded cache ("a future streaming track supplies its own HeightSource");
`TerrainChunkManager` already has `activate(gx,gz)`/`deactivate(gx,gz)`
(`:124-149`) + per-chunk distance LOD bands + hysteresis (`terrainLod.ts:28-60`)
but NO streaming driver; `Renderer.applyTerrainLod` already feeds
`terrain.update(cameras)` the live focus each frame (`Renderer.ts:367-375`,
called `:244`). Seeding infra for per-chunk dressing exists: `hashSeed` +
`makeRNG` (`rng.ts:77-84`).

Design tension + resolution: the game is a CLOSED-LOOP circuit race (spline
radius ~62). "Infinite terrain" therefore = the heightfield/colors/colliders
extend forever around a finite road loop (Minecraft-style endless hills
surrounding the track). The road stays; beyond the blend distance it is pure
procedural simplex hills. Since `heightAt = pathY + noise*w` and `w=1` far from
the track (`heightmap.ts:137-148`), a streaming HeightSource (bounded cache
inside; on-demand `spline.closestPoint` outside -> identical formula) is
seamless, no special-casing. Dressing (user choice) streams too: per-chunk for
terrain-bound props/wildlife; follow-focus for atmospheric clouds/weather/water.

Real constraints, resolved against code:

- `heightAt`/`colorAt` one shared fn (`src/AGENTS.md:69`); streaming keeps
  semantics identical everywhere (same formula, cache vs closestPoint source).
- Mesh + collider verts identical PER CHUNK (`src/AGENTS.md:72`); streamed
  chunks keep buildChunk -> trimesh parity (`TerrainChunkManager.ts:218-224`).
- HEIGHT_MAP (PR #26 / open 021) is ONE global bounded texture over worldSize
  (`TerrainChunkManager.ts:111,247-276`, shared material `:112`) -> can't cover
  infinity. Resolution (user choice): near-track chunks keep HEIGHT_MAP cel
  normal; streamed/far chunks use mesh vertex normals. Two-material split.
- `closestPoint` is O(samples=1024)/query (`SplineTrack.ts:103-128`); only far
  verts use it (low LOD -> few verts) -> cost bounded. Kart never goes there.
- PropField/wildlife bake once at ctor over worldHalfExtent; per-chunk needs a
  per-rect sampler (coordinate-stable seed) -> new pure `sampleChunkProps`.
- File budgets: Terrain 168, TerrainChunkManager 276, Environment 88,
  PropField 300 -> room; new dressing manager stays <600.

## Goal

Two phases (each shippable; Phase A is the core ask):

Phase A - infinite surface + wall removal:

- Remove the boundary wall (meshes + bodies + dispose).
- Streaming HeightSource: bounded `SplineFieldCache` in-bounds, on-demand
  `closestPoint` out-bounds -> identical heightAt/colorAt/normalAt everywhere.
- Streaming chunk driver: signed grid coords (gx,gz in Z), activate chunks
  within a radius of the nearest camera, deactivate (cull) beyond. Drop v1
  "activate all". Per-chunk LOD bands unchanged.
- Two-material cel: near-track (cache region) keeps HEIGHT_MAP; far/streamed
  uses vertex normals.

Phase B - streaming dressing (user choice; larger half):

- Per-chunk deterministic props + wildlife (coordinate-stable seed) tied to the
  same chunk grid; activate/deactivate with terrain chunks; full per-chunk
  dispose (meshes + Rapier bodies).
- Clouds/weather/water follow the focus (recenter on humansMidpoint, wrap) ->
  infinite-feeling without per-chunk cost.

## Non-goals

- Removing/changing the closed-loop race track or race systems (007). The road
  stays a finite loop; infinite is the surrounding terrain.
- GPU tessellation / clipmap (CPU chunk build only, as 019).
- Web Worker build path in v1 (builder stays pure/worker-able; wiring deferred).
- Editing tools / in-game terrain modification.
- Multi-biome terrain (single simplex hill field; biomes = follow-on).
- Reverting #26 HEIGHT_MAP (correct architecture; only its coverage changes).
- Changing heightAt/collider semantics or the mesh/collider parity invariant.

## Architecture (change)

```text
src/terrain/
  heightSource.ts      # ADD StreamingHeightSource(cache, spline, cfg, noise):
                       #   in-bounds -> existing fns; out-of-bounds ->
                       #   closestPoint fallback, same formula. HeightSource
                       #   iface unchanged. WorldHeightSource stays
                       #   (tests/back-compat).
  streamGrid.ts        # NEW PURE: chunkCoord(worldXZ,chunkSize)->{gx,gz};
                       #   chunkRect(gx,gz,chunkSize)->ChunkRect (signed grid,
                       #   origin-centered); desiredChunks(foci,radius,cull)->
                       #   Set<key> (union over cameras). jsdom-testable.
  TerrainChunkManager.ts # Signed grid; ctor activates only chunks in radius of
                       #   a seed focus (origin); update(cameras) runs the
                       #   streaming driver: desired-set diff vs active ->
                       #   activate new / deactivate culled (throttled). Two
                       #   materials: materialNear (HEIGHT_MAP over worldSize,
                       #   near-region chunks) + materialFar (vertexColors, no
                       #   heightMap). buildHeightTexture stays bounded to
                       #   worldSize (near region only). Keep activate/
                       #   deactivate/update/dispose parity + LOD.
  Terrain.ts           # DROP buildBoundaryWall + walls/wallBodies/wallMaterial
                       #   + their dispose; swap WorldHeightSource ->
                       #   StreamingHeightSource; keep heightAt/normalAt/
                       #   waterLevel/spline/startPos/update/dispose. ctor takes
                       #   streamRadius/cullRadius opts.
src/environment/
  propSampler.ts       # ADD PURE sampleChunkProps(rect,terrain,baseSeed,
                       #   layerOpts): jittered grid over rect ONLY; corridor/
                       #   spawn rejection no-op far from track (dist large ->
                       #   passes); slope/height rejection via terrain. Per-
                       #   chunk seed = hashSeed(gx+","+gz) ^ baseSeed.
  DressingChunkManager.ts # NEW: mirrors terrain grid 1:1. activate(gx,gz,rect)
                       #   -> per-chunk PropField bundle (merged big-prop mesh +
                       #   Rapier bodies + decor InstancedMesh) + critter
                       #   instances for rect; deactivate -> full dispose
                       #   (meshes + bodies). Driven by terrain active-set (or
                       #   shared streamGrid focus).
  Clouds.ts/Weather.ts # Follow-focus: recenter particle field on humansMidpoint
                       #   each update, wrap at extent (infinite-feeling).
  Water.ts             # Follow-focus (recenter large plane on midpoint) OR
                       #   enlarge size; minor.
  Environment.ts       # Hold DressingChunkManager; update(dt,time,focus) drives
                       #   it + passes focus to clouds/weather/water. dispose
                       #   cascades.
src/core/
  Game.ts/FieldBuilder.ts # humansMidpoint (FieldBuilder.ts:320) already
                       #   computed per frame for shadows (Game.ts:230) -> reuse
                       #   as focus. Wire Environment.update focus +
                       #   DressingChunkManager.
```

## Contracts with 001-021

- 001: none (chunks reuse CelMaterial; two-material split is cel-only).
- 002/010/014: none (sky/sun/moon/clouds world-agnostic; clouds follow-focus).
- 003: consumes heightAt/colorAt/SplineFieldCache unchanged in-bounds;
  StreamingHeightSource extends out-of-bounds with identical semantics.
- 004: PropField per-chunk variant (sampleChunkProps); bucketing becomes
  per-chunk (fewer props/chunk -> ~1 merged mesh/chunk). Disposition unchanged.
- 005/009/015: none.
- 006: phase gating unchanged (streaming only in racing/paused via
  applyTerrainLod; menu keeps a static seeded set around origin).
- 007/008: rivals/humans drive on streamed colliders; seam-free (shared
  heightAt). No wall -> a human may roam; lap progress stays cut-proof
  (closestPoint t frozen off-track); respawn-ahead unchanged.
- 011: consumes quality tiers + LOD band pattern; F3 StatsHud = verify readout.
- 017: wildlife per-chunk (coordinate-stable seed); same orbit-pose update.
- 018: water level global (sandLevel); water plane follow-focus. Buoyancy
  unchanged.
- 019: BUILDS ON IT (HeightSource + activate/deactivate + LOD). This is the
  documented follow-on.
- 021 (OPEN): HEIGHT_MAP filtering. COORDINATE: 023's two-material split should
  land AFTER 021 (or merge the near-material change) to avoid texture/material
  conflict. Recommend 023 depends on 021.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

Phase A:

1. `feat(terrain): pure signed-grid stream helpers`
   - `streamGrid.ts` (chunkCoord/chunkRect/desiredChunks); tests (signed coords,
     rect symmetry, desired-set union + cull).
2. `feat(terrain): streaming height source (closestPoint fallback)`
   - `heightSource.ts` StreamingHeightSource; tests: in-bounds ==
     WorldHeightSource; out-of-bounds == closestPoint formula; seamless at the
     boundary.
3. `feat(terrain): streaming chunk driver + two-material cel`
   - `TerrainChunkManager.ts` signed grid + driver (desired-set diff, throttled
     activate/deactivate, cull) + materialNear/materialFar; tests (mock physics
     - THREE): activate in-radius, deactivate beyond cull, body count bounded
       while roaming, dispose frees all.
4. `refactor(terrain): drop boundary wall; wire streaming source`
   - `Terrain.ts`: delete buildBoundaryWall + wall dispose; swap to
     StreamingHeightSource + streamRadius/cullRadius opts. tests: ray-parity
     across streamed colliders; heightAt/normalAt unchanged in-bounds; no wall
     bodies; dispose -> body count 0.
5. `feat(core): focus-driven streaming into Game/Renderer`
   - reuse cameras (already wired) as foci; verify streaming runs in racing/
     paused, static seeded set in menu. tests: Game.test mocks updated.

Phase B:

1. `feat(environment): per-chunk deterministic prop sampler`
   - `propSampler.ts` sampleChunkProps; tests: coordinate-stable (same gx,gz ->
     identical), corridor rejection no-op far, slope rejection holds.
2. `feat(environment): streaming dressing chunk manager`
   - `DressingChunkManager.ts` (per-chunk PropField bundle + critters; full
     dispose); tests: activate builds + bodies, deactivate frees, deterministic
     re-activate reproduces placement.
3. `feat(environment): follow-focus clouds/weather/water`
   - recenter on humansMidpoint + wrap; tests: field stays centered on focus.
4. `feat(core): wire dressing streaming + focus into Environment/Game`
   - Environment.update(dt,time,focus); humansMidpoint focus; dispose cascade.
5. `docs: refine 023 plan + todo + README + troubleshooting`
   - mark 023 full plan; troubleshooting verify (F3: draw calls/tris/frame ms
     while roaming, body-count stable, no leak; no black screen; seamless across
     old 100 m boundary; no wall).

## Risks

- Streaming hitch: building chunk geometry + trimesh + per-chunk props on the
  main thread on activate. Mitigation: throttle activates/frame; hysteresis;
  builder is pure -> Web Worker follow-on. Verify F3 frame ms while roaming.
- Memory/body leak: far chunks must fully free geometry + trimesh bodies + prop
  bodies + critter meshes. Mitigation: body-count assertion while roaming;
  verify physics body count stays bounded.
- closestPoint cost far out: O(1024)/far vertex. Bounded (low LOD, sparse).
  Coarse far-only cache = follow-on if it shows in F3.
- Two-material cel seam at the near/far boundary (~100 m, low visual weight):
  verify cel look continuous; HEIGHT_MAP vs vertex-normal transition.
- Dressing per-chunk seams: props are discrete, don't tile across edges ->
  acceptable; big-prop bucketing per-chunk (<=1 mesh/chunk).
- Determinism: per-chunk seed MUST be coordinate-stable (hashSeed(gx,gz)) so
  roaming back reproduces identical placement. Test.
- Rapier body churn (activate/deactivate): verify broadphase stable, no spikes.
- 021 coordination: HEIGHT_MAP material split conflicts if 021 lands first
  independently. Sequence 023 after 021 (or merge). Documented, dependency.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [x] No boundary wall; kart drives past 100 m into endless procedural hills
      (1P + 2P); roaming works in both directions indefinitely
- [x] Terrain chunks stream around the camera; far chunks deactivate + free
      bodies (body count bounded while roaming; no leak over 60 s roam)
- [x] heightAt/colorAt/normalAt seamless across the old 100 m boundary (no
      visible step/seam); mesh/collider parity invariant holds on streamed chunks
- [x] Ray-parity guard passes on streamed colliders; kart drives gap-free across
      streamed chunk seams (1P + 2P)
- [x] Near-track keeps HEIGHT_MAP cel normal; far/streamed uses vertex normals;
      no black screen; cel look continuous
- [x] Phase B: props + wildlife stream per chunk (deterministic, coordinate-
      stable); clouds/weather/water follow focus (infinite-feeling)
- [x] All touched files <= 600 lines; `typecheck && lint && test` + hook green
- [ ] F3 readout in `docs/troubleshooting/`: draw calls/tris/frame ms before vs
      after + while roaming; body-count stable; seamless boundary; no wall
      (code-complete; pending runtime verify)

## Defaults

- chunkSize: 25 m (unchanged from 019). Signed grid, origin-centered.
- streamRadius: 140 m (>= mid band 110 so far band still loads). cullRadius:
  170 m. Tunable via TerrainOptions.
- streaming focus: nearest active camera (already wired via applyTerrainLod);
  2P = union over both cameras (desiredChunks handles the union).
- HeightSource: StreamingHeightSource (cache in-bounds; closestPoint fallback).
- materials: materialNear (HEIGHT_MAP over worldSize 200, near-region chunks
  within cache bounds) + materialFar (vertexColors, no heightMap, streamed).
- per-chunk dressing seed: hashSeed(gx + "," + gz) ^ baseSeed.
- activate throttle: max ~4 chunk activations/frame (hitch budget); tunable.
- clouds/weather/water: recenter on humansMidpoint each update, wrap at extent.

## Previous implementation

None. Built directly on 019 (HeightSource `heightSource.ts:54-58`, activate/
deactivate `TerrainChunkManager.ts:124-149`, LOD bands `terrainLod.ts:28-60`,
applyTerrainLod `Renderer.ts:367-375`). Dressing patterns: PropField
`PropField.ts:115-143`, sampleProps `propSampler.ts:78-100`, Wildlife
`critters.ts:147-211`, Clouds/Weather follow-focus recenter. Seeding:
hashSeed/makeRNG `rng.ts:77-84`. closestPoint `SplineTrack.ts:103-128`.

## Depends on

000 (harness). 003 (heightmap heightAt/colorAt/SplineFieldCache). 019
(chunking: HeightSource + activate/deactivate + LOD — this is its documented
follow-on).
004 (PropField/sampler), 017 (Wildlife) for Phase B. #26 (HEIGHT_MAP per-pixel
normal; coverage changes to near-only). Coordinate with OPEN 021 (HEIGHT_MAP
filtering — recommend 023 lands after 021) and OPEN 022 (perf pass — 023's
streaming hitch/body-churn mitigations overlap 022's GC-pool +
matrixAutoUpdate + LOD-body-toggle work). Independent of 005-016/020.
