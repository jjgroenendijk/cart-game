---
type: Subsystem
title: Chunk Streaming
description: "Per-chunk terrain streaming: camera focus, distance LOD, HeightSource abstraction."
tags: [terrain, streaming, lod]
timestamp: 2026-07-05T00:00:00Z
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

## streamGrid.ts

Shared signed-grid helpers used by terrain and dressing streaming drivers:

- `chunkKey(gx, gz)` → unique string key
- `chunkBounds(key)` → world-space AABB
- `chunkCenter(key)` → world-space center
- `desiredChunks(cameraPos, radius)` → set of keys in range

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
