---
type: Subsystem
title: Skid Marks
description: Terrain-conformed skid mark quad-strip mesh with age-fade shader on layer 1.
tags: [kart, skid-marks, shader]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Terrain-conformed skid marks as quad-strip mesh on layer 1.

Append while drifting + grounded (any wheel) + not in water + moved >
minStep. ~6s linear fade (SKID_FADE_TIME).
polygonOffset prevents z-fighting. Age-fade shader keyed on uTime.
Reads uAmbient from lightUniforms.

## Architecture

skidMarks.ts is pure segment + age-fade math (no THREE).
SkidMarksLayer.ts is the GL owner.

## Quality Tiers

| Tier   | Segment Budget |
| ------ | -------------- |
| Low    | 256            |
| Medium | 512            |
| High   | 1024           |

Same filename split rationale as VFX.

# Citations

- [VFX](/kart/vfx.md)
- [KartController](/kart/controller.md)
- [Quality](/core/quality.md)
