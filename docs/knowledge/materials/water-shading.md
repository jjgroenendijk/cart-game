---
type: Shader
title: Water Shading
description: Depth-aware cel water GLSL shader with pure math mirror for testing, shared WAVE table.
tags: [materials, shader, water]
timestamp: 2026-07-05T00:00:00Z
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
- Quantized world-space sun glint band
- Low quality tier zeroes glints

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
