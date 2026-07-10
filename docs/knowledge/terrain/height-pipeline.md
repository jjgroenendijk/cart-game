---
type: Subsystem
title: Height Pipeline
description: Shared heightAt(x,z) feeding terrain mesh, vertex colors, Rapier collision geometry.
tags: [terrain, heightmap, rendering]
timestamp: 2026-07-08T00:00:00Z
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
single source for normals derived from the heightmap. Chunk mesh normals and
`Terrain.normalAt` route through this function; vertex colors use `colorAt`,
and Rapier consumes the shared displaced vertex buffer rather than separate
collider normals. See [normal-from-height.md](normal-from-height.md).

## Corridor Invariance

`heightAt` on the centerline equals `spline.y` — terrain noise weight is 0
on-track. This means `DRIVE_GRADE` guards the shared SPLINE, not biome
relief. Biomes don't affect the driveable corridor; the track surface is
biome-independent.

Since 084 the corridor cross-section is no longer always level: banking is
baked into the `SplineFieldCache` `pathY` grid at build time. Per cell, the
cache adds `tan(bankAt(s)) * lateral * fade` to the pose's centerline
`pathY`, where `lateral` is the signed left-of-travel offset clamped to the
local half-width and `fade` smooth-steps to 0 over `blendWidth` past the
corridor edge. A banked cross-section is a plane, so the O(1) bilinear
query reproduces it exactly; `heightFromField`, `heightAt`,
`colorFromField`, and `normalFromHeight` are untouched, and mesh ==
collider still holds by construction (one shared `heightAt`). Height stays
single-valued per (x, z); the CENTERLINE height (`GraphPose.pathY`,
respawn, routing) is unchanged. See
[circuit-banking.md](circuit-banking.md).

`WorldHeightSource` is the default adapter binding
`SplineFieldCache + TerrainConfig + SimplexNoise2D`. `StreamingHeightSource`
extends queries beyond the `SplineFieldCache` grid extent by falling through
to the TrackGraph nearest-station query (`cache.graph.closestOnGraph`) for
out-of-bounds areas — in-bounds stays O(1) bilinear, out-of-bounds resolves
the nearest station over the mainline and branch edges. The graph fallback
carries no bank term, which is seam-safe: bank fades out within
`halfWidth + blendWidth` of the centerline while the world boundary sits at
least the 30 m generator margin away from any track point.

## Terrain Relief Seed

Terrain relief noise (`SimplexNoise2D`, `noise.ts`) is seeded by
`TerrainConfig.noiseSeed`. `DEFAULT_TERRAIN_CONFIG.noiseSeed` is `1337` (a
fallback for tests / standalone construction), but in production
`Game.buildWorld` overrides it per circuit:

```ts
terrainCfg.noiseSeed = (hashSeed("terrain") ^ id.seed) >>> 0;
```

So the off-track hills vary with the seed, using the codebase `hashSeed(label)
^ seed` convention (mirrors `selectBiome`, environment `worldSubSeeds`). The
track (centerline `heightAt` == `spline.y`) is unaffected — the corridor
invariance above still holds. Previously the relief was fixed at 1337 for every
seed; existing saved seeds now render different hills (intended).

## SplineFieldCache

Uniform world grid of `{dist, pathY, t, halfWidth, edgeId}` sampled once at
build time from the `TrackGraph` (a lone mainline edge, or mainline + branch
edges). Turns the O(N) `closestPoint` scan into an O(1) bilinear query so
per-vertex `heightAt` calls for mesh/collider buffers stay fast, and per-kart
race/AI pose queries stay O(1) too. `query(x,z)` returns
`{dist, pathY, halfWidth}`; `queryPose(x,z)` returns `{dist, t, halfWidth}`
with wrap-aware `t` for race logic.

## Vertex Colors

CelMaterial uses `vertexColors: true` for road/grass/rock/sand on
[render layer 1](/conventions/render-layers.md).

`colorAt` (in `heightmap.ts` `colorFromField`) blends biome colors in a
fixed priority order:

1. Road corridor: hard early-return (crisp road, no blend).
2. Grass: remainder baseline.
3. Rock: weight = `smoothstep(rockSlope ± rockBlendSlope)` where
   `rockSlope` comes from the biome config and `rockBlendSlope` defaults
   to 0.15.
4. Sand: weight = `1 - smoothstep(sandLevel ± sandBlendHeight)` where
   `sandLevel` is biome-defined and `sandBlendHeight` defaults to 1.0.

Vertex color attribute values are sRGB->LINEAR to match ColorManagement.

# Citations

- [Chunk Streaming](/terrain/chunk-streaming.md)
- [HeightSource](/terrain/chunk-streaming.md)
- [CelMaterial](/materials/cel-material.md)
