---
type: Convention
title: Normal from Height
description: >
  Central-difference surface normal helper and single source for normals
  derived from the heightmap.
tags: [terrain, normals, height]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`normalFromHeight` is the single shared function for computing smooth surface
normals from the height field. One definition feeds `chunkBuilder`, `Terrain`,
and unit tests — border normals match exactly across chunk seams. Defined in
`src/terrain/heightSource.ts`.

## Signature

```ts
function normalFromHeight(
  x: number,
  z: number,
  hAt: (x: number, z: number) => number,
  out?: Vec3,
  eps?: number,
): Vec3;
```

`Vec3 = [number, number, number]`. THREE-free, pure.

## Central-Difference Formula

Samples `hAt` at four offset points with spacing `eps` (default 0.5 m,
matches the historical `Terrain.normalAt` radius):

```text
dx = (hAt(x+eps, z) - hAt(x-eps, z)) / (2 * eps)
dz = (hAt(x, z+eps) - hAt(x, z-eps)) / (2 * eps)
n  = normalize((-dx, 1, -dz))
```

The denominator's `ny = 1` preserves the surface-normal orientation (+Y up).
No THREE, no WebGL — pure math.

## Role in the Height Pipeline

`HeightSource.normalAt` delegates directly to `normalFromHeight` with
`this.heightAt` as the `hAt` callable. This means:

1. **Single source**: `WorldHeightSource`, `StreamingHeightSource`, and
   `Terrain.normalAt` all share the same math → no formula drift.
2. **World-consistent**: Chunks do NOT compute per-chunk `computeVertexNormals`.
   Every sampled normal derives from the global height field, so adjacent
   chunk borders shade identically in the cel material.
3. **Streaming-aware**: `StreamingHeightSource.normalAt` routes through the
   same `normalFromHeight` with its own `heightAt` (in-bounds cache +
   out-of-bounds `cache.graph.closestOnGraph`), keeping border normals
   seamless across the old world boundary.

`chunkBuilder.buildChunk` pulls normals from `src.normalAt` and writes them
directly into the vertex buffer. The Rapier trimesh collider is built from
the same mesh buffer — visual and collision geometry agree by construction.

## See Also

- [Height Pipeline](height-pipeline.md) — `HeightSource` interface and adapters
- [Cel Material](materials/cel-material.md) — cel bands and world-normals dependence
