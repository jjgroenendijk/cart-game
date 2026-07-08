---
type: Subsystem
title: Water
description: Depth-aware cel-shaded water plane with shore foam bands, depth tinting, and sun glint.
tags: [environment, water, shader]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`CelWaterMaterial` (062) — the shader material class in `celWater.ts` —
powers the water plane on layer 1. The `Water.ts` class uses
`CelWaterMaterial` internally; `CelWater` is the containing module, not the
class name.

Depth-aware: samples terrain bed-height field for banded shore-foam line and
shallow-to-deep tint computed from true water depth.

Quantized world-space sun glint tracks sun position. Low quality tier zeroes
glints via `waterGlintIntensity`.

The additive glint term is multiplied by the exported `GLINT_HDR_BOOST`
(2.5) constant so specular water sparkles clear the day bloom threshold
(2.1 linear) and bloom in the HDR pipeline.

## Shading

Pure math mirror lives in `materials/waterShading.ts`. The
shared WAVE table is the single source of truth.

`waterColor` from biome feeds `uTint` (white = identity for temperate).

`waterShallow`/`waterDeep` (BiomeDefinition) flow Environment -> Water ->
CelWater `uShallow`/`uDeep`; undefined = CelWater shader defaults (identity).
Tropical sets teal->deep-blue; other biomes omit them.

Outside baked field, falls back to legacy facing look — no seam pop.

# Examples

```glsl
// Water depth tint in fragment shader (positive = deeper)
float depth = uWaterY - bedH;
vec3 tint = mix(shallowColor, deepColor, smoothstep(0.0, maxDepth, depth));
```

# Cross-References

- [CelMaterial](/materials/cel-material.md)
- [Water Shading](/materials/water-shading.md)
- [Biomes](/terrain/biomes.md)
