# 019 terrain chunking — verify log

Date: 2026-06-27
Item: 019 (terrain chunking)
Status: code-verified; live visual + F3 perf verify deferred to review

## Scope

Pre-019 terrain was ONE displaced PlaneGeometry (~40k verts) + ONE Rapier
trimesh over a fixed 200 m world, with no dispose. 019 lays a streaming-
capable foundation: the world tiles into a grid of chunks (v1 8x8), each a
standalone layer-1 mesh + standalone trimesh collider built from one shared
HeightSource, with per-chunk near/mid/far LOD bands (hysteresis) + skirts that
seal band cracks. A chunk manager owns activate/deactivate/update/dispose; v1
activates all in-world chunks (bounded). Huge-map + infinite-track streaming
are explicit follow-ons that extend the HeightSource + activation radius.

## Commits (each atomic + green)

1. `feat(terrain): pure height source + chunk builder + skirts` —
   `heightSource.ts` (HeightSource + WorldHeightSource adapter) +
   `chunkBuilder.ts` (buildChunk + buildSkirt, pure typed-array out). +20
   tests. Root + src AGENTS refresh (gov 1000-LOC reset; Runtime Flow depicts
   the 019 chunked-terrain + terrain-LOD deliverable).
2. `feat(terrain): pure chunk LOD band selector` — `terrainLod.ts`
   (chunkLod band + hysteresis, nearestChunkCameraDistance, segmentTier
   keyed off quality). +21 tests.
3. `feat(terrain): streaming-capable chunk manager` —
   `TerrainChunkManager.ts` (activate/deactivate/update/dispose; spatial
   grid; shared CelMaterial; mesh merges chunk+skirt, collider uses chunk
   only). +11 tests.
4. `refactor(terrain): Terrain uses chunk manager; add dispose` — Terrain
   swaps single mesh+collider for the manager over a HeightSource; keeps
   heightAt/normalAt/waterLevel/spline/startPos + the boundary wall; adds
   update(cameras) + dispose. Terrain.test migrated (ray-parity guard now
   spans the chunked collider set).
5. `feat(core): wire terrain LOD + dispose into Game/Renderer` —
   Renderer.applyTerrainLod (per-render, mirrors applyKartLod) + terrain
   field; Game sets renderer.terrain + terrain.dispose. +3 tests
   (Game.terrain.test.ts split out to keep Game.test.ts under 600 lines).

## Code-verified (this pass)

- `heightSource.ts` (44): pure interface + adapter; chunk layer never imports
  SplineFieldCache directly.
- `chunkBuilder.ts` (190): buildChunk row-major verts, (a,c,b)+(b,c,d)
  winding matching Terrain's trimesh; buildSkirt 4-edge outward drop strip.
  Pure (no THREE/Rapier in the math path).
- `terrainLod.ts` (100): chunkLod near/mid/far + ~chunkSize hysteresis
  (mirrors kartLod); segmentTier high/med 25/12/6, low drops near->12.
- `TerrainChunkManager.ts` (208): grid-keyed chunk set; activate builds
  layer-1 mesh (merged chunk+skirt) + trimesh body from buildChunk only
  (mesh+collider share verts by construction); update rebuilds on tier
  change only (hysteresis); dispose frees all bodies+geometries+shared
  material, idempotent.
- `Terrain.ts` (169): TerrainChunkManager over WorldHeightSource (default
  8x8, quality-keyed); heightAt/normalAt/waterLevel/spline/startPos
  unchanged; update(cameras) + dispose (chunks + wall meshes + wall bodies
  - materials). Single mesh/collider fields + segments option dropped.
- `Renderer.ts` (398): public `terrain` field + applyTerrainLod called once
  per renderViews after applyKartLod (1P/2P nearest-cam rule).
- `Game.ts` (466): sets renderer.terrain in ctor; terrain.dispose() in
  dispose. body count -> 0 after game.dispose() (chunks + walls + karts +
  props all freed).
- Ray-parity guard: 0 misses, worst height error < 0.3 across the 4x4
  chunked trimesh set (seam-crossing rays at chunk boundaries -10/0/10).
- Gate: typecheck + eslint + markdownlint + prettier + secretlint +
  pre-commit all green. 873 tests (was 818; +55). `npm run build` succeeds
  (only the pre-existing chunk-size warning).
- All touched files <= 600 lines (TerrainChunkManager 208, Terrain 169,
  Renderer 398, Game 466, Game.test 598).

## Deferred to review

- Live visual + F3 perf verify: no browser canvas in this env. Reviewer
  should `npm run dev`, Start, and confirm:
  - no black screen; terrain renders gap-free across chunk boundaries
    (drive over a seam at ~25 m grid spacing in 1P + 2P);
  - F3 StatsHud readout: draw calls / tris / frame ms before (single mesh)
    vs after (64 chunks). All-near v1 ~= today's ~40k verts (no regression);
    far chunks dropping to mid/far tiers should reduce far tris;
  - LOD rebuild hitches are imperceptible on the bounded world (hysteresis
    limits tier changes; under-kart chunks stay near);
  - kart suspension rays hit reliably on every chunk (no falls through).
- No-black-screen proxy: build is green; chunk meshes reuse the existing
  layer-1 CelMaterial + PostOutline layer-1 pre-pass (geometry-agnostic), so
  the render path is structurally unchanged.

## Notes

- Height truth stays world-global: one HeightSource (WorldHeightSource
  binding the global heightmap fns) feeds mesh + collider. Chunking is an
  architecture change, not a height-semantics change (heightAt/normalAt
  bit-identical).
- Collider uses buildChunk only (the driving surface); the skirt is visual
  (seals LOD-band cracks) and is NOT collidable.
- dispose now exists (pre-019 Terrain leaked every chunk + wall body).
- Forward-compat (NOT solved here): SplineFieldCache is world-global +
  bounded; a future infinite-track item must supply a streaming HeightSource
  - an activation radius. Documented in the plan's non-goals.
