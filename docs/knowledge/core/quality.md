---
type: System
title: Quality
description: Quality tiers mapping performance budgets to pixel ratio, shadows, VFX.
tags: [core, performance, quality]
timestamp: 2026-07-05T00:00:00Z
---

# Quality

Maps quality tiers (`QualityTier = "low" | "med" | "high"`, default high) to
knobs: pixelRatio, shadowMapSize, shadowCameraFar, shadowHalfExtent,
vfxParticleBudget, skidSegments, waterGlintIntensity, and postGradeStrength.

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

## Citations

- [Renderer](/core/renderer.md)
- [VFX](/kart/vfx.md)
- [SkidMarks](/kart/skid-marks.md)
- [Quality Propagation](/data-flows/quality-propagation.md)
