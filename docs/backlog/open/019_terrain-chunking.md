# 019 Terrain chunking

Status: open (full plan — ready for execution)

## Context

Split from 011 (was 011's "Terrain LOD" goal; `011:67,118,211`). Today terrain is
ONE displaced PlaneGeometry at 200x200 segments (~40k verts, `Terrain.ts:104`) plus
ONE Rapier trimesh collider built from the same buffer (`Terrain.ts:127-162`), over
a fixed 200 m world (`Terrain.ts:59`). No chunking, no LOD, no skirts, no dispose
(`Terrain.ts` has no dispose; `Game.dispose` `Game.ts:168-184` skips terrain).

019's premise gated on "011's measured hotspot". That gate is moot: the goal is no
longer micro-opt of the 40k mesh, it is architecture. Huge maps + infinite
procedural racing are future work; a single global mesh + single global trimesh +
one world-global `SplineFieldCache` (`heightmap.ts:56-109`) cannot scale to either.
019 lays a streaming-capable chunked mesh + chunked collider foundation and
exercises it on the current bounded 200 m circuit (all chunks active). Huge maps +
infinite-track generation are explicit follow-on items that extend this base.

Real constraints, resolved against current code:

- `heightAt`/`colorAt` stay one shared fn (`src/AGENTS.md:69`); chunking must not
  change their semantics (019 non-goal). Chunks are BUILT from a height source,
  not owners of height truth.
- Mesh + collider verts identical by construction (`src/AGENTS.md:72`). Enforced
  PER CHUNK: each chunk's trimesh is built from that chunk's positions/indices.
  Heightfield stays ruled out (rays miss ~60% on 0.19.3, `Terrain.ts:41-47`).
- `SplineFieldCache.query` clamps at world bounds (`heightmap.ts:87-90`): edge
  chunks + skirts sample valid heights, no NaN. Beyond-worldHalf streaming needs a
  streaming height source + parametric cache -> follow-on, NOT 019.
- Chunk deactivate API exists: `physics.world.removeRigidBody(body)`
  (`PropField.ts:156`, `FieldBuilder.ts:188,193`); body removal drops its
  colliders. PropField dispose is the precedent (`src/AGENTS.md:85-86`).
- LOD band pattern to mirror: pure `kartLod(distance,prev,opts)` band + ~5 m
  hysteresis (`kartLod.ts:56-78`), `nearestCameraDistance` over active cameras
  (`:85-96`), per-render `Renderer.applyKartLod` (`Renderer.ts:327-339`).
- Quality tiers exist (`core/quality.ts`): low/med/high; near-tier segment count
  keys off the tier so low-end drops verts globally.
- PostOutline layer-1 pre-pass is geometry-agnostic (renders layer 1 by override
  material, `postOutline.ts:165-191`): chunk meshes stay on layer 1 -> NO change,
  verify edges only.
- File budgets: `Terrain.ts` 194, `heightmap.ts` 220, `Renderer.ts` 380,
  `Game.ts` 464, `FieldBuilder.ts` 394 — all clear of the 600 cap with room.
- jsdom tests (no Rapier/WebGL): export pure chunk builder + LOD fns, assert
  directly (mirrors `buoyancyForce`, `kartLod`). Parity guard re-verified via
  `RAPIER.init` + PhysicsWorld stub (`KartController.test.ts:7-11` pattern).

## Goal

- Streaming-capable chunked terrain: world tiled into a fixed grid (v1 8x8 = 64
  chunks over 200 m), each chunk a standalone mesh + standalone Rapier trimesh
  collider built from the same per-chunk buffer.
- Per-chunk distance LOD bands (near/mid/far segment tiers) with hysteresis,
  keyed off `quality.ts`; geometry skirts seal cracks between bands.
- A chunk manager with an activate/deactivate interface (v1: all in-world chunks
  active; future: radius around a focus point) + a real dispose.
- Chunk layer agnostic to the height source so the future infinite-track item
  supplies a streaming source without rework. Chunk builder is a pure fn ->
  worker-able later (v1 synchronous).

## Non-goals

- Huge-map or infinite procedural track generation/streaming (follow-on items).
- Changing `heightAt`/`colorAt`/`SplineFieldCache` semantics (one shared source).
- GPU tessellation / clipmap (CPU chunk build only).
- A Web Worker build path in v1 (builder is pure/worker-able; wiring deferred).
- Editing tools / in-game terrain modification.
- Revisiting Rapier heightfield (ruled out by the parity guard).

## Architecture (new)

```text
src/terrain/
  heightSource.ts   # PURE interface HeightSource { heightAt(x,z),
                    #   colorAt(x,z,out) } + default adapter binding the
                    #   world-global heightmap fns (v1). Future streaming track
                    #   supplies its own HeightSource. Chunk layer never imports
                    #   SplineFieldCache directly.
  chunkBuilder.ts   # PURE buildChunk(rect{x0,z0,x1,z1,segX,segZ}, src) ->
                    #   {positions, colors, indices}. Displaced + vertex-colored
                    #   per vertex via src. buildSkirt(rect,src,drop) -> edge
                    #   strip indices/verts sealing band cracks. Pure ->
                    #   jsdom-testable + worker-able.
  terrainLod.ts     # PURE chunkLod(distance, prevTier, opts) -> near/mid/far
                    #   with ~chunkSize hysteresis (mirrors kartLod.ts:56-78);
                    #   nearestChunkCameraDistance(chunkCenter, cameras);
                    #   segmentTier(tier, lod) -> seg count keyed off quality.
  TerrainChunkManager.ts # Active chunk set keyed by grid coord. activate ->
                    #   build mesh layer 1 + trimesh body, add to group +
                    #   physics. deactivate -> remove mesh + removeRigidBody.
                    #   update(cameras) -> per-chunk LOD tier, rebuild on tier
                    #   change (hysteresis). dispose -> remove all + free geo.
                    #   v1 ctor activates all in-world chunks (bounded). Spatial
                    #   grid (coord -> chunk) for O(1) lookup.
  Terrain.ts        # REPLACE single buildMesh (Terrain.ts:102-125) + single
                    #   buildTrimeshCollider (:127-162) with a TerrainChunk-
                    #   Manager over a HeightSource. KEEP heightAt/normalAt
                    #   (:74-87), waterLevel (:97-100), spline/startPos
                    #   (:89-95), boundary wall (:164-193). Expose group (public
                    #   already, :49) + update(cameras) + dispose. DROP single
                    #   `mesh` (:51) + single `collider` (:52); migrate consumers
                    #   (audit; tests likely only).
src/core/
  Game.ts           # set renderer.terrain = this.terrain (Game.ts:69-70 area);
                    #   call this.terrain.update(cameras) in the racing frame
                    #   block; this.terrain.dispose() in dispose (:168-184).
                    #   ~6-10 lines. Game 464 -> clear of 600.
  FieldBuilder.ts   # likely NONE (holds terrain ref :83/:112, uses heightAt +
                    #   waterLevel only). Verify no `terrain.mesh`/`.collider`
                    #   read; if found, migrate to group/manager.
src/renderer/
  Renderer.ts       # ADD applyTerrainLod(terrain, cameras) next to
                    #   applyKartLod (:327-339), called once per renderViews so
                    #   the LOD pass uses the real active cameras (1P/2P).
                    #   ~15 lines. Renderer 380 -> clear of 600.
```

## Contracts with 001-018

- 001: none (chunks reuse `makeCel({vertexColors:true})` layer 1, `Terrain.ts:120`).
- 002: none.
- 003: consumes `heightAt`/`colorAt`/`SplineFieldCache` unchanged; provides
  `Terrain.waterLevel`/`spline`/`startPos` unchanged.
- 004: none (props/critters sample `terrain.heightAt`, unchanged).
- 005/009/015: none.
- 006: phase gating unchanged (terrain.update only called in the racing block).
- 007/008: rivals/humans drive on chunked colliders; seam at chunk boundaries
  must be gap-free (shared edge heightAt) -> verify in acceptance.
- 010: none.
- 011: consumes `core/quality.ts` tiers + the `kartLod` band/hysteresis pattern;
  F3 StatsHud used as the verify readout (acceptance, not prerequisite).
- 014/017/018: none.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(terrain): pure height source + chunk builder + skirts`
   - `heightSource.ts` (interface + world-global adapter), `chunkBuilder.ts`
     (`buildChunk` + `buildSkirt`).
   - tests: buildChunk vertex count = (segX+1)(segZ+1); positions match
     heightAt; colors match colorAt; skirt seals edges (no zero-area gap);
     pure (no THREE/Rapier import in chunkBuilder math path).
2. `feat(terrain): pure chunk LOD band selector`
   - `terrainLod.ts` (`chunkLod` band + hysteresis,
     `nearestChunkCameraDistance`, `segmentTier` keyed off quality).
   - tests: band thresholds + hysteresis (no flicker across boundary);
     nearest camera wins; low tier reduces segment count.
3. `feat(terrain): streaming-capable chunk manager`
   - `TerrainChunkManager.ts` (activate/deactivate/update/dispose; spatial
     grid; v1 activates all in-world chunks).
   - tests (mock physics + mock THREE mesh): activate builds mesh+body;
     deactivate removes both; update rebuilds on tier change only; dispose
     idempotent + frees all.
4. `refactor(terrain): Terrain uses chunk manager; add dispose`
   - `Terrain.ts`: swap single mesh+collider for the manager over a
     HeightSource; keep heightAt/normalAt/waterLevel/spline/startPos/wall;
     add `update(cameras)` + `dispose()`; drop single `mesh`/`collider`
     fields + migrate consumers/tests.
   - tests: ray-parity guard (Terrain.test.ts:65-87) still passes against
     the chunked collider set (castRay hits the right chunk); heightAt/
     normalAt unchanged; dispose removes all bodies.
5. `feat(core): wire terrain LOD + dispose into Game/Renderer`
   - Renderer.applyTerrainLod; Game sets renderer.terrain + calls
     terrain.update in the racing block + terrain.dispose in dispose.
   - tests: Game.test mocks updated (no render regression); dispose frees
     terrain (body count -> 0).
6. `docs: refine 019 plan + todo + README + troubleshooting`
   - mark 019 full plan in `docs/todo.md`; README structure adds new files;
     troubleshooting verify case (F3 readout: draw calls/tris/frame ms
     before vs after, no black screen, seam-free drive over chunk edges).

## Risks

- Chunk-boundary seam: adjacent trimeshes must share edge heights (same
  heightAt) so the kart rolls gap-free. Mitigation: build edges from the shared
  height source; verify by driving across a boundary in acceptance. Add a
  ray-parity-across-boundary test.
- 64 trimesh colliders vs 1 today: more broadphase entries (64 AABBs) but each
  BVH is smaller -> net neutral or better; verify via F3 frame ms. Parity guard
  must still pass (castRay auto-selects the chunk under the ray).
- LOD rebuild hitches: rebuilding a chunk's geometry on tier change on the main
  thread. Hysteresis limits frequency; v1 world is small (few tier changes).
  Worker is the future mitigation (builder is already pure).
- `terrain.mesh`/`.collider` field removal: breaking if any consumer reads them.
  Audit in commit 4; migrate tests + any reader to the group/manager.
- Skirt depth: too shallow -> crack; too deep -> overdraw. Default drop below
  min terrain height in chunk; tune in review.
- Forward-compat coupling: `SplineFieldCache` is world-global + bounded
  (heightmap.ts:56-109). 019 does NOT unbounded-stream; future infinite-track
  item must supply a streaming HeightSource. Documented, not solved here.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [ ] `chunkBuilder.ts` + `terrainLod.ts` pure + tested (no THREE/Rapier in math)
- [ ] World tiled into chunks (v1 8x8); each chunk = layer-1 mesh + trimesh body
- [ ] Per-chunk near/mid/far LOD bands + hysteresis; skirts seal band cracks
- [ ] Ray-parity guard passes against the chunked collider set (no ray misses)
- [ ] Kart drives gap-free across chunk boundaries (1P + 2P)
- [ ] `Terrain.update(cameras)` + `Terrain.dispose()` wired; dispose frees all
      bodies + geometries (body count -> 0)
- [ ] heightAt/normalAt/waterLevel/spline/startPos semantics unchanged
- [ ] All touched files <= 600 lines; `typecheck && lint && test` + hook green
- [ ] F3 readout logged in `docs/troubleshooting/`: draw calls/tris/frame ms
      before vs after (no regression on the bounded world); no black screen

## Defaults

- grid: 8x8 chunks over 200 m (chunkSize 25 m). Tunable.
- segment tiers per chunk side: near 25 (1/m), mid 12, far 6; keyed off quality
  (low drops near->mid globally). All-near v1 ~= today's 40k verts (no regression).
- hysteresis: ~chunkSize (25 m), mirrors kartLod's band stability.
- skirt: vertical drop below min chunk terrain height, edge verts from heightAt.
- collider: one Rapier fixed body + trimesh per chunk, verts identical to the
  chunk mesh by construction; removeRigidBody on deactivate/dispose.
- v1 activation: all in-world chunks (bounded). Streaming radius = follow-on.

## Previous implementation

None. Closest patterns: kartLod band+hysteresis + nearestCameraDistance +
Renderer.applyKartLod (`kartLod.ts:56-96`, `Renderer.ts:327-339`); PropField
spatial bucketing "merge visuals, keep colliders" + removeRigidBody dispose
(`PropField.ts:156`, `011:84-92`); quality tiers (`core/quality.ts`); pure
builder fn for tests (`buoyancyForce` in 018, `impactTier` in 009); RAPIER.init
test stub (`KartController.test.ts:7-11`); ray-parity guard (`Terrain.test.ts:
65-87`).

## Depends on

000 (harness; test gate live). 003 (terrain mesh + trimesh collider + heightAt).
001 (cel material + PostOutline layer-1 pre-pass; unchanged, edges verified).
011 (quality tiers + kartLod band pattern + F3 StatsHud readout; measurement is
an acceptance verify, not a prerequisite). Independent of 004-010/012-018.
Forward-compat (NOT deps): huge-map scale + infinite procedural track streaming
are follow-on items that extend the HeightSource + activation radius.
