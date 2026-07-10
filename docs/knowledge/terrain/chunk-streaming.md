---
type: Subsystem
title: Chunk Streaming
description: "Per-chunk streaming: shared planStream planner, focus, distance LOD, HeightSource."
tags: [terrain, streaming, lod]
timestamp: 2026-07-10T00:00:00Z
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
  colorAt(x: number, z: number): Color;
  normalAt(x: number, z: number): Vector3;
}
```

Chunks never import SplineFieldCache directly. `WorldHeightSource` adapter
binds global heightmap functions.

## TerrainChunkManager Materials

Two-material cel split per chunk:

- `materialNear` — `HEIGHT_MAP` over `worldSize`, renders chunks inside the
  near/cache region where the baked height texture has data.
- `materialFar` — vertex colors only, no height map (vertex normals), renders
  streamed chunks outside the near region. Far verts come from the
  `HeightSource` via `StreamingHeightSource.closestPoint`.

## Collider Caching

Per-tier colliders are pre-cached; on tier change the previous collider flips
`setEnabled(false)` and the new tier's collider flips `setEnabled(true)` —
no remove/recreate, no mid-frame BVH rebuild.

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

`WaterChunkManager` is the first consumer (see
[Water](/environment/water.md)). `TerrainChunkManager` and
`DressingChunkManager` still carry their own reconcile loops and migrate onto
`planStream` in a later slice.

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
- [Biomes](/terrain/biomes.md)
