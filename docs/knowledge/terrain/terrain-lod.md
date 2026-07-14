---
type: Subsystem
title: Terrain LOD
description: "Distance-based LOD for terrain chunk meshes with hysteresis to prevent flickering."
tags: [terrain, lod, quality]
timestamp: 2026-07-14T23:55:00Z
---

# Schema

`src/terrain/terrainLod.ts` maps chunk distance to the nearest active camera
into LOD bands and per-side segment counts. Pure helper (numbers in, tier
out), jsdom-testable, no WebGL deps.

## Tiers

`TerrainLodTier = "near" | "mid" | "far"`

Default thresholds (configurable via `TerrainLodOpts`):

| Band | Distance | Visible chunks | Detail                |
| ---- | -------- | -------------- | --------------------- |
| near | < 50 m   | ~2             | Highest (25 seg/side) |
| mid  | 50–110 m | ~4–5           | Medium (20 seg/side)  |
| far  | > 110 m  | remainder      | Lowest (12 seg/side)  |

## Hysteresis

`DEFAULT_TERRAIN_LOD.hysteresis = 25` (~chunkSize). When a `prevTier` is
supplied to `chunkLod()`, thresholds widen so the tier stays stable at band
edges:

- near holds until `near + hys` (75 m)
- mid holds from `near - hys` to `mid + hys` (25–135 m)
- far holds until `mid - hys` (85 m)

Without hysteresis a chunk oscillating between two bands would rebuild its
geometry every frame.

## Core Functions

| Export                                | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `chunkLod(d, prevTier?, opts?)`       | Resolve tier from distance with optional hysteresis     |
| `nearestChunkCameraDistance(c, cams)` | Min distance across active cameras                      |
| `segmentTier(tier, lod)`              | Per-side segment count keyed on quality tier + LOD band |

## Quality Tier Interaction

`segmentTier()` maps `QualityTier x TerrainLodTier` → segment count:

| Quality  | near | mid | far |
| -------- | ---- | --- | --- |
| high/med | 25   | 20  | 12  |
| low      | 12   | 20  | 12  |

Low tier caps near to 12 (dropped to mid level) to reduce vertex count
globally on low-end hardware. Mid and far are not quality-capped — they
are already conservative.

## Budget Scaling

`terrainBudgets(worldSize)` scales heightmap texels and chunk grid count to
world size:

- `heightTexels = clamp(pow2ish(worldSize * 1.4), 384, 1024)`
- `gridCount = clamp(round(worldSize / 48), 8, 16)`

`pow2ish(n)` rounds to the nearest power of two. At the default 200 m world
these match the pre-scaled defaults (384 texels, 8x8 grid).

## Tier-swap smoothing

Discrete tessellation swaps are hidden by two complementary mechanisms during
the tier-transition band (both gated on `crossFadeSeconds > 0`, off on low):

- Alpha dither cross-fade — old tier dissolves OUT, new tier dissolves IN (see
  [Chunk Streaming](chunk-streaming.md) LOD tier cross-fade).
- Geomorph — each cross-fade mesh slides its vertex HEIGHTS toward the adjacent
  tier's tessellation (`aMorphTarget` + `uMorph`, driven by the same fade clock)
  so the tessellation change causes no vertex pop. See
  [Chunk Streaming](chunk-streaming.md) LOD geomorph.

Geomorph is a VISUAL vertex slide only: `heightAt`, the trimesh collider, and
suspension raycasts are never morphed (collider uses unmodified `buildChunk`
verts and swaps at fade start). Morph targets are sampled from the shared
`HeightSource.heightAt`, so they stay deterministic and seam-consistent.

## See Also

- [Quality](core/quality.md) — `QualityTier` enum and tier knobs
- [Chunk Streaming](chunk-streaming.md) — `TerrainChunkManager` consuming LOD
