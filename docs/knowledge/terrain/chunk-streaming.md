---
type: Subsystem
title: Chunk Streaming
description: "Per-chunk streaming: shared planStream planner, focus, distance LOD, HeightSource."
tags: [terrain, streaming, lod]
timestamp: 2026-07-14T00:00:00Z
---

# Schema

## TerrainChunkManager

Streams chunks around camera focus. Manages chunk lifecycle: creation, disposal,
and distance-based prioritization.

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
no remove/recreate, no mid-frame BVH rebuild.

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
