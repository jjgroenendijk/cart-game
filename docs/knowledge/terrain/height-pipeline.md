---
type: Subsystem
title: Height Pipeline
description: Shared heightAt(x,z) feeding terrain mesh, vertex colors, Rapier collision geometry.
tags: [terrain, heightmap, rendering]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

One shared `HeightSource` interface (`heightSource.ts`) feeds:

- Visual terrain mesh (displaced vertices)
- Terrain vertex colors (road/grass/rock/sand)
- Rapier trimesh collider

Terrain collider is a Rapier trimesh built from the same displaced mesh
buffer — mesh vertices and collider vertices are identical by construction.

## HeightSource Interface

The core abstraction. Three methods, one contract — chunks never import
`SplineFieldCache` directly. `normalAt` provides world-consistent normals
across chunk seams (no per-chunk `computeVertexNormals`).

```ts
interface HeightSource {
  heightAt(x: number, z: number): number;
  colorAt(x: number, z: number, out?: Rgb): Rgb;
  normalAt(x: number, z: number, out?: Vec3): Vec3;
}
```

## normalFromHeight

`normalFromHeight` (central-difference helper in `heightSource.ts`) is the
single source for normals derived from the heightmap. Every consumer — mesh
vertices, vertex colors, collider normals — routes through this function.
See [normal-from-height.md](normal-from-height.md).

## Corridor Invariance

`heightAt` on the centerline equals `spline.y` — terrain noise weight is 0
on-track. This means `DRIVE_GRADE` guards the shared SPLINE, not biome
relief. Biomes don't affect the driveable corridor; the track surface is
biome-independent.

`WorldHeightSource` is the default adapter binding
`SplineFieldCache + TerrainConfig + SimplexNoise2D`. `StreamingHeightSource`
extends queries beyond the `SplineFieldCache` grid extent by falling through
to `SplineTrack.closestPoint` for out-of-bounds areas — in-bounds stays O(1)
bilinear, out-of-bounds degrades gracefully.

## SplineFieldCache

Uniform world grid of `{dist, pathY, t}` sampled once at build time from
`SplineTrack`. Turns the O(N) `closestPoint` scan into an O(1) bilinear query
so ~40k per-vertex `heightAt` calls (mesh + heightfield) stay fast, and
per-kart race/AI pose queries stay O(1) too. `query(x,z)` returns
`{dist, pathY}`; `queryPose(x,z)` adds wrap-aware `t` for race logic.

## Vertex Colors

CelMaterial uses `vertexColors: true` for road/grass/rock/sand on
[render layer 1](/conventions/render-layers.md).

Vertex color attribute values are sRGB→LINEAR to match ColorManagement.

# Citations

- [Chunk Streaming](/terrain/chunk-streaming.md)
- [HeightSource](/terrain/chunk-streaming.md)
- [CelMaterial](/materials/cel-material.md)
