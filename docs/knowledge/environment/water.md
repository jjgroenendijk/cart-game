---
type: Subsystem
title: Water
description: Depth-aware cel-shaded water plane with shore foam bands, depth tinting, and sun glint.
tags: [environment, water, shader]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

CelWater (062) renders a water plane on layer 1.

Depth-aware: samples terrain bed-height field for banded shore-foam line and
shallow-to-deep tint computed from true water depth.

Quantized world-space sun glint tracks sun position. Low quality tier zeroes
glints via `waterGlintIntensity`.

## Shading

Pure math mirror in [waterShading.ts](/materials/water-shading.md). The
shared WAVE table is the single source of truth.

`waterColor` from biome feeds `uTint` (white = identity for temperate).

Outside baked field, falls back to legacy facing look — no seam pop.

# Examples

```glsl
// Water depth tint in fragment shader
float depth = bedHeight - waterHeight;
vec3 tint = mix(shallowColor, deepColor, smoothstep(0.0, maxDepth, depth));
```

# Cross-References

- [CelMaterial](/materials/cel-material.md)
- [Water Shading](/materials/water-shading.md)
- [Biomes](/terrain/biomes.md)
