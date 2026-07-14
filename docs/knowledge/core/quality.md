---
type: System
title: Quality
description: Quality tiers mapping performance budgets to pixel ratio, shadows, VFX.
tags: [core, performance, quality]
timestamp: 2026-07-14T23:30:00Z
---

# Quality

Maps quality tiers (`QualityTier = "low" | "med" | "high"`, default high) to
knobs: pixelRatio, shadowMapSize, shadowCameraFar, shadowHalfExtent,
vfxParticleBudget, skidSegments, waterGlintIntensity, postGradeStrength, and
the draw-distance / LOD budgets.

## Schema

| Tier | pixelRatio       | shadowMap | far | half | VFX  | Skid | glint | grade |
| ---- | ---------------- | --------- | --- | ---- | ---- | ---- | ----- | ----- |
| low  | 1                | 1024      | 120 | 60   | 512  | 256  | 0     | 1     |
| med  | 1.5              | 2048      | 200 | 80   | 1536 | 512  | 1     | 1     |
| high | Math.min(dpr, 2) | 2048      | 400 | 80   | 3072 | 1024 | 1     | 1     |

`DEFAULT_QUALITY = "high"`. Column abbreviations: `shadowMap` = `shadowMapSize`;
`far` = `shadowCameraFar`; `half` = `shadowHalfExtent`; `VFX` =
`vfxParticleBudget`; `Skid` = `skidSegments`; `glint` = `waterGlintIntensity`
(0 disables on low); `grade` = `postGradeStrength` (1 = full look on every
tier; near-free ALU). `Renderer.setQuality` applies + rebuilds shadow map.
`FieldBuilder.setQuality(tier)` and `Game.setQuality(tier)` forward tier
changes through the system. Domain modules (kartVfx.ts, skidMarks.ts) export
matching copies (`VFX_BUDGET`, `SKID_SEGMENTS`) kept in sync by comment so
GL owners stay decoupled from core. See
[quality-propagation](/data-flows/quality-propagation.md).

## Draw-distance / LOD budgets

The distant-rendering toolkit (terrain streaming, LOD cross-fade, incremental
chunk seed, far-decor density falloff) is tier-gated so LOW stays within its
current budget while HIGH — the default — reaches farther:

| Tier | drawCap | seedBudget | crossFade | densityMin |
| ---- | ------- | ---------- | --------- | ---------- |
| low  | 200     | 8          | 0         | 0.25       |
| med  | 280     | 12         | 0.4       | 0.30       |
| high | 360     | 16         | 0.4       | 0.35       |

`drawCap` (`terrainDrawCap`) is the max world-scaled terrain + dressing stream
radius in metres; `Game.buildWorld` clamps the world-sized stream radius to
`[140, drawCap]` (cull `+30`) so LOW streams a nearer fog horizon than HIGH.
`seedBudget` (`terrainSeedBudget`) caps chunks activated per frame during the
incremental ctor seed. `crossFade` (`terrainCrossFadeSeconds`) is the LOD
tier-swap dither duration; LOW is 0 (instant snap, no transient double draw —
consistent with `TerrainChunkManager` gating the fade off on low). `densityMin`
(`dressingDensityMin`) is the far-decor density floor; LOW thins distant
scatter hardest. HIGH reproduces the pre-tier-gate fixed constants exactly, so
the default tier does not regress. `Game.buildWorld` resolves these from
`qualityKnobs(qualityTier, dpr)` at each world (re)build; `setQuality` records
the tier so the next rebuild picks it up. Collider radius (`COLLIDER_RADIUS` /
`COLLIDER_CULL_RADIUS` = 140/170) stays tier-independent — physics safety: karts
need ground + prop colliders around them at every tier.

## Citations

- [Renderer](/core/renderer.md)
- [VFX](/kart/vfx.md)
- [SkidMarks](/kart/skid-marks.md)
- [Quality Propagation](/data-flows/quality-propagation.md)
