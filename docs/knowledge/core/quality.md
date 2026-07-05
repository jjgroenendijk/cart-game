---
type: System
title: Quality
description: Quality tiers mapping performance budgets to pixel ratio, shadows, VFX.
tags: [core, performance, quality]
timestamp: 2026-07-05T00:00:00Z
---

# Quality

Maps quality tiers (low/medium/high, default high) to knobs: pixelRatio, shadow
extents, VFX particle budgets, and skid segments.

## Schema

| Tier   | pixelRatio | VFX budget | Skid segments |
| ------ | ---------- | ---------- | ------------- |
| low    | 0.5        | 512        | 256           |
| medium | 0.75       | 1536       | 512           |
| high   | 1.0        | 3072       | 1024          |

`Renderer.setQuality` applies + rebuilds shadow map. `FieldBuilder.setQuality` +
`Game.setQuality` forward tier changes. Domain modules export matching budgets
(`VFX_BUDGET` in kartVfx, `SKID_SEGMENTS` in skidMarks) kept in sync by
comment.

## Citations

- [Renderer](/core/renderer.md)
- [VFX](/kart/vfx.md)
- [SkidMarks](/kart/skid-marks.md)
