---
type: Subsystem
title: Chunk Streaming
description: "Per-chunk streaming: shared planStream planner, focus, distance LOD, HeightSource."
tags: [terrain, streaming, lod]
timestamp: 2026-07-27T10:00:00Z
---

# Schema

## TerrainChunkManager

Streams chunks around camera focus. Manages chunk lifecycle: creation, disposal,
and distance-based prioritization.

## Incremental ctor seed

The ctor's origin seed is spread over frames so the largest worlds do not hitch
at load. `ChunkSeeder` (`chunkSeed.ts`) owns the deferred-key queue + budget and
PLANS the seed (returns the chunks to build now); `TerrainChunkManager` does the
mesh/collider build + LOD tier resolution. `seedBudget` (default `Infinity`) caps
both the synchronous ctor seed and the per-frame drain:

- `Infinity` — the ctor seeds every origin-desired chunk now (pre-206 behavior);
  tests + headless keep a fully-seeded world with no opt-in.
- Finite — the ctor seeds only the nearest-to-origin `seedBudget` chunks
  (`ChunkSeeder.seedInitial`, nearest-first with a key tie-break) and enqueues
  the rest. Each `update(cameras)` first calls `drainSeed` -> `ChunkSeeder.drain`:
  it drops pending keys already made active (by `planStream`/`primeSeed`), orders
  the remainder nearest-camera-first (XZ, key tie-break), and returns up to
  `seedBudget` to activate before the normal stream/LOD passes. So the visible
  region under the menu or chase camera fills before the far horizon (which the
  fog hazes). Draining uses the 3D camera distance for the activated chunk's LOD
  tier, matching a streamed activation; a drain with `cameras = [origin]`
  reproduces the synchronous seed's chunk set + tiers exactly (eventual parity).

`primeSeed(foci, radius)` (via `ChunkSeeder.prime`) force-seeds any still-pending
chunk within `radius` (XZ) of a kart focus. `Game.buildField` calls it over the
collider
ring (`COLLIDER_RADIUS`) before the first physics step, so gameplay-critical
terrain near the spawn/start line — and, via the following `updateColliders`
pass, its trimesh colliders — exist frame 0 even when the start line sits far
from the origin seed. `pendingCount` exposes the remaining queue. `Game` passes
`seedBudget` from the quality tier (`qualityKnobs().terrainSeedBudget`: low 8,
med 12, high 16 — high matches the pre-tier-gate constant); `Terrain` forwards
the option and `primeSeed`. The world-scaled stream/cull radii are likewise
capped by the tier's `terrainDrawCap` (low 200, med 280, high 360 m) so low-end
streams a nearer fog horizon. See [Quality](/core/quality.md).

## Chunk Builder

`chunkBuilder.ts` — pure per-chunk geometry builder emitting typed arrays from
a `HeightSource`. Normals come from `src.normalAt` (world consistent, no
per-chunk `computeVertexNormals`) so neighbor chunk borders shade identically.

Properties:

- jsdom-testable
- Worker-compatible (zero DOM or Three imports)

## HeightSource Interface

```ts
interface HeightSource {
  heightAt(x: number, z: number): number;
  colorAt(x: number, z: number, out?: Rgb): Rgb;
  normalAt(x: number, z: number, out?: Vec3): Vec3;
}
```

`Rgb`/`Vec3` are tuples (THREE-free); the optional `out` is a scratch buffer.

Chunks never import SplineFieldCache directly. `WorldHeightSource` adapter
binds global heightmap functions.

## TerrainChunkManager Materials

Two-material cel split per chunk:

- `materialNear` — `HEIGHT_MAP` over `worldSize`, renders chunks inside the
  near/cache region where the baked height texture has data.
- `materialFar` — vertex colors only, no height map (vertex normals), renders
  streamed chunks outside the near region. Far verts come from the
  `HeightSource`; out of bounds `StreamingHeightSource` resolves via the
  TrackGraph (`cache.graph.closestOnGraph`), not a `closestPoint` method.

## Collider Caching

Per-tier colliders are pre-cached; on tier change the previous collider flips
`setEnabled(false)` and the new tier's collider flips `setEnabled(true)` —
no remove/recreate, no mid-frame BVH rebuild. The trimesh geometry build
(`createTierCollider`, base verts only) and the visual mesh assembly
(`buildChunkMeshGeometry`, merged base + skirt) live in `chunkGeometry.ts`,
the THREE/Rapier-aware sibling of the THREE-free `chunkBuilder.ts`
(`chunkBuilder.ts` stays pure typed arrays + worker-able).

## LOD tier cross-fade

A chunk's LOD tier swap can dither cross-fade through the fog band instead of
snapping tessellation (`crossFadeSeconds > 0`, default `0.4` s via
`Terrain.DEFAULT_CROSS_FADE_SECONDS`). `beginCrossFade` keeps the old-tier mesh
alongside a freshly built new-tier mesh; the old takes an inverse dither-fade
material (`cel.ts` `fadeInvert`, dissolving OUT) and the new a normal fade
material (`fade`, dissolving IN). Both `uFade`s ramp to the same progress `t`
(0->1), so the two tessellations partition every pixel (no overlap, no depth
fight) — see `src/terrain/chunkCrossFade.ts` + `src/materials/fade.ts`. At
`t>=1` the old mesh is disposed and the survivor reverts to the shared solid
material, dropping the dither's early-Z cost at steady state.

Progress advances on an internal monotonic clock (`now`, seconds; injectable),
frame-rate-independent, with `dt` clamped to `0.1` s (hitch guard). Physics does
not cross-fade: the trimesh collider + `state.tier` swap immediately at fade
start. The transient dither materials are built by `terrainCelMaterials.ts`
(`buildNearCel`/`buildFarCel` in the chunk's own family), so the fade is
shading-seamless. Gated off on the low quality tier (snaps via `rebuild`) so
low-end never pays the transient double terrain draw; `Game` also passes
`crossFadeSeconds` from the tier (`qualityKnobs().terrainCrossFadeSeconds`: low
0, med/high 0.4), so low is 0 from both directions. `crossFadeSeconds = 0`
reproduces the pre-198 instant swap. Streaming activate/deactivate does not
cross-fade — the fog already hazes the horizon edge.

## LOD geomorph

The alpha cross-fade hides the tessellation SWAP but the coarser mesh samples
height at fewer points, so its silhouette/ridges still SHIFT. Geomorphing
removes that vertex pop: each cross-fade mesh slides its vertex HEIGHTS toward
the adjacent tier's tessellation over the same fade clock, so at the swap the
two meshes are geometrically identical. It rides on the `crossFadeSeconds`
band — same tier-gate (off on low, which snaps) — so no separate knob.

`beginCrossFade` attaches an `aMorphTarget` attribute to BOTH meshes
(`attachMorphTarget` in `chunkCrossFade.ts` -> `buildMorphTargets` in
`chunkBuilder.ts`): per fine vertex, the bilinearly-interpolated height on the
OTHER tier's grid, computed as a per-`(x,z)` height DELTA
(`otherTierHeight - heightAt`) added to the vertex's CURRENT y — so it is
correct for base verts, skirt-top verts, and skirt-bottom (dropped) verts
uniformly, and is exactly 0 at shared grid vertices (no morph there). The cel
material's `geomorph` opt (see [CelMaterial](/materials/cel-material.md)) does
`transformed.y = mix(position.y, aMorphTarget, uMorph)` in the vertex shader.
`stepCrossFade` drives the outgoing mesh `uMorph = t` (collapses toward the new
tier) and the incoming mesh `uMorph = 1 - t` (blooms FROM the old tier), so both
represent the other tier at `t = 1`. The incoming "in" material starts at
`uMorph = 1` (set by the builder) so it matches the outgoing mesh at fade start.

Invariant: geomorph is a VISUAL vertex slide ONLY. It touches vertex y in the
transient fade material's vertex shader; `heightAt`, the trimesh collider, and
suspension raycasts are never morphed (colliders use unmodified `buildChunk`
verts and swap immediately at fade start). Morph targets are sampled from the
same `HeightSource.heightAt` so they are deterministic and seam-consistent. The
survivor reverts to the shared solid material (no `GEOMORPH`) at `t >= 1`; its
geometry keeps the unused `aMorphTarget` buffer until the chunk is disposed.
Only the near material's heightmap per-pixel normal stays exactly correct during
the morph (normal from the height texture at `(x,z)`, independent of vertex y);
far chunks (vertex normals, hazed by fog) get a minor transient normal mismatch.

## Collider-range decoupling

Visual draw distance is decoupled from collider range so extending the stream
radius to the fog horizon does not multiply Rapier colliders. Two independent
passes:

- Visual: `update(cameras)` streams meshes (activate/deactivate + LOD) around
  the camera focus via `streamRadius`/`cullRadius` (world-scaled up to the fog
  horizon).
- Physics: `refreshColliders(foci)` builds/enables a chunk's trimesh collider
  only while its center is within `colliderRadius` (XZ) of a collider focus
  (kart/AI position), and disables it past `colliderCullRadius` (hysteresis).
  The reconcile is the pure `planColliderRefresh` planner in
  `chunkColliderRange.ts` (mirrors `planStream` in `chunkStream.ts`); the
  manager applies its `enable`/`disable` lists via its own tier-collider
  hooks. `withinColliderRange` (used at `activate`) delegates to
  `colliderFocusDistance` in the same module.

Every active chunk still owns one fixed Rapier body (near-free without an
enabled collider), so body count tracks active-chunk count; only the trimesh
BVH + broadphase presence is gated. `activate` lazily builds the collider only
when the chunk is already in range; `rebuild` (tier change) swaps the enabled
collider only for chunks whose colliders are on. `colliderRadius`/
`colliderCullRadius` default to `Infinity` -> every active chunk keeps its
collider (coupled behavior); `Game` passes finite, world-independent values so
the collider ring stays bounded near the karts while terrain renders to the
horizon. `Game` sources the foci from `FieldBuilder.kartFoci()` (all human +
AI kart positions) so a far off-camera rival still has ground colliders.

## HLOD backdrop (203)

Beyond the streamed cull ring there used to be nothing — fog hid an empty wall,
so the horizon read as a fog band, not real distant terrain. The HLOD backdrop
(`terrainBackdrop.ts` + the pure `backdropGeometry.ts`) fills that: ONE static
coarse mesh of the world past the streamed ring, so ridgelines/silhouettes reach
the fog horizon.

- Geometry (`buildBackdropRing`, pure/jsdom-testable): a polar annulus centred
  on the camera focus — `radialSegments+1` rings from `innerRadius`
  (`= cullRadius`, meeting the streamed ring) out to `outerRadius`
  (`cullRadius + terrainBackdropReach`, past the fog horizon so it hazes fully
  out), `angularSegments` columns wrapping seamlessly (column A joins 0). Verts
  sample the SAME `StreamingHeightSource` the chunks do (`heightAt/colorAt/
normalAt`), so its ridgelines align with the streamed terrain. Up-facing
  winding matches the chunk mesh. An optional outer skirt drops the far edge by
  `skirtDrop` (inward-facing wall) so the horizon reads solid. Counts:
  `(rings + skirt)*A` verts, `(radialSegments·A·2 + skirt·A·2)·3` indices —
  ~1.7k verts / one draw at the 16×96 default.
- `TerrainBackdrop` (THREE wrapper): owns the mesh + its OWN far cel material
  (`buildFarCel`, vertex colours + `USE_FOG`) so it hazes into the fogged
  horizon and shares the terrain hue (sky+fog hue-sharing invariant). Recentres
  on the mean camera focus snapped to `recenterStep` (coarse) — rebuilds only
  when the focus crosses a cell, never per-frame. Geometry is authored at
  absolute world coords (never a translated mesh) so ridgelines stay aligned and
  bounds stay correct; `frustumCulled=false` (the ring surrounds every camera;
  #175 recentred-field gotcha). Layer 1, `receiveShadow`.
- `Terrain` owns the optional backdrop (from `TerrainOptions.backdrop`), adds it
  to its group, drives it from `Terrain.update(cameras)` after the chunk pass,
  and disposes it. Tier-gated via `terrainBackdropReach`, which currently ships
  at 0 on EVERY tier — the ring read as dark near-horizon "mountains" rather than
  receding haze, so no backdrop is built and the horizon falls back to the fog
  wall; the code stays dormant (opt-in) until retuned. See
  [Quality](/core/quality.md).

INVARIANT: the backdrop is a PURE visual far mesh. It has no collider and no
Rapier body (the `TerrainBackdrop` ctor takes no `PhysicsWorld`), and it never
touches `heightAt`, the trimesh collider, or suspension raycasts — it only READS
the shared `HeightSource`. The fog covers the inner seam where it meets the
streamed cull ring (radii are aligned so there is no gap/overlap the eye can
resolve through the haze).

## streamGrid.ts

Shared signed-grid helpers used by terrain, dressing, and water streaming
drivers:

- `chunkKey(gx, gz)` → unique string key; `parseChunkKey(key)` → `{ gx, gz }`
- `chunkBounds(gx, gz, chunkSize)` → world-space AABB
- `chunkCenter(gx, gz, chunkSize)` → world-space center
- `desiredChunks(foci, radius, chunkSize)` → set of keys in range (union over
  all camera foci; `foci` is `Pt[]`, supports multiple camera positions)
- `nearestFocusDistanceXZ(x, z, foci)` → min XZ distance to any focus (Y
  ignored), the "which world cells exist" metric

## chunkStream.ts — shared streaming planner (071)

`planStream(active, foci, policy)` is the pure reconcile step layered over
streamGrid. Given a subsystem's live chunk keys and the observer set, it
returns `{ activate, deactivate }`:

- `deactivate` — active chunks past `cullRadius` of every focus.
- `activate` — desired-not-active chunks (inside `streamRadius` of any focus),
  ordered nearest-first (key tie-break for determinism), capped at
  `maxActivations` (hitch budget).

`StreamPolicy` = `{ chunkSize, streamRadius, cullRadius, maxActivations }`.
Two radii give hysteresis (`cullRadius >= streamRadius`) so a boundary chunk
does not flap. Empty foci → empty plan (an observerless frame changes nothing).
Distances are XZ-only; the planner owns chunk-KEY selection only — meshes,
colliders, materials, and particles stay in each subsystem's own
create/dispose (071 non-goal: no universal object manager).

All three streaming subsystems consume `planStream`: `WaterChunkManager` (see
[Water](/environment/water.md)), `TerrainChunkManager`, and
`DressingChunkManager` each build a `StreamPolicy` from their radii/budget and
call `planStream(activeKeys, cameras, policy)` in `update`, then apply the
returned `activate`/`deactivate` against their own chunk map. Activation is
nearest-first everywhere (was row-major Set order pre-071).

`TerrainChunkManager` keeps its LOD tier resolution local and on the 3D camera
distance (`nearestChunkCameraDistance`): detail depends on camera altitude, not
just which cells exist, so it is not folded into the XZ-only planner. Streaming
selection (which chunks exist) is XZ-only via `planStream`, matching the ctor
seed. An optional per-subsystem debug/StatsHud readout (active/pending/culled
counts) remains future work.

## LOD

`terrainLod.ts` — distance-based LOD tiers:

| Tier | Range  | Vertex density |
| ---- | ------ | -------------- |
| near | close  | full           |
| mid  | medium | reduced        |
| far  | far    | minimal        |

# Citations

- [Height Pipeline](/terrain/height-pipeline.md)
- [Dressing](/environment/dressing.md)
- [Biomes](/biomes/framework.md)
