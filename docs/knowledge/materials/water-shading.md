---
type: Shader
title: Water Shading
description: Depth-aware water shader with continuous Fresnel, HDR glint, and pure math mirrors.
tags: [materials, shader, water]
timestamp: 2026-08-01T07:30:00Z
---

# Schema

Water rendering with two implementations sharing a single WAVE table.

| Component    | File              | Role                                    |
| ------------ | ----------------- | --------------------------------------- |
| CelWater     | `celWater.ts`     | Depth-aware GLSL shader for runtime     |
| WaterShading | `waterShading.ts` | Pure math mirror for testing (no WebGL) |
| WAVE table   | Shared constant   | Single source of truth for both         |

**CelWater features:**

- Samples terrain bed-height field for banded shore-foam line
- Shallow→deep tint by true water depth
- Ripple normal from WAVE table
- Continuous world-space Blinn-Phong glint; aligned peaks reach 1.5× intensity
  so ACES gives the scene-linear highlight a bright, localized rolloff
- Continuous facing/Fresnel response; `uBands` remains bound only for API
  compatibility
- Low quality tier zeroes glints
- Manual 4-tap bilinear height sampling (shared height texture is `NearestFilter`
  for cel terrain normal path, so CelWater does its own bilinear interpolation)

**`FOAM` constant table** (shared CPU/GPU paths in `waterShading.ts`):

| Constant            | Purpose                               |
| ------------------- | ------------------------------------- |
| `FOAM.EDGE_INNER`   | Inner foam edge limit                 |
| `FOAM.EDGE_OUTER`   | Outer foam edge limit                 |
| `FOAM.WARP_FREQ`    | Foam distortion frequency             |
| `FOAM.WARP_DRIFT`   | Foam warp animation speed             |
| `FOAM.WARP_AMP`     | Foam warp amplitude                   |
| `FOAM.DETAIL_FREQ`  | Detail noise frequency                |
| `FOAM.DETAIL_DRIFT` | Detail animation speed                |
| `FOAM.DETAIL_GAIN`  | Detail noise attenuation              |
| `FOAM.SLOPE_MIN`    | Minimum slope for foam (below = none) |
| `FOAM.SLOPE_LO`     | Lower slope gate threshold            |
| `FOAM.SLOPE_HI`     | Upper slope gate threshold            |

**Bed-slope gating**: `FOAM.SLOPE_MIN/LO/HI` prevents flat pools from showing
white foam — foam only appears on sloped shorelines.

# Examples

```ts
// waterShading.ts — pure math mirror sketch
function foamBand(depth: number, foamDepth: number, bandWidth: number): number {
  return clamp(1.0 - depth / foamDepth, 0.0, 1.0);
}

function depthTint(depth: number, shallowColor: vec3, deepColor: vec3): vec3 {
  return mix(shallowColor, deepColor, clamp(depth / maxDepth, 0.0, 1.0));
}
```

# Citations

- [Water](/environment/water.md)
- [CelMaterial](/materials/cel-material.md)
- [Renderer](/core/renderer.md)
