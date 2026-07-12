---
type: Shader
title: Outlines
description: Inverted-hull outline for solid geometry and post-Sobel edge detection for terrain.
tags: [materials, shader, outline]
timestamp: 2026-07-12T00:00:00Z
---

# Schema

Two outline techniques for cel-style rendering.

| Technique       | Layer | Target         | Method                                  |
| --------------- | ----- | -------------- | --------------------------------------- |
| Inverted-hull   | 0     | Solid geometry | Scaled hull, back-face culling reversed |
| PostOutlinePass | 1     | Terrain        | Normal + depth discontinuity check      |

`InvertedHullMaterial` uses `side: THREE.BackSide` — front faces are culled,
back faces are rendered (back-face culling reversed). Helper functions:
`addOutline(mesh)` adds an outline child mesh; `removeOutline(mesh)` removes it.

PostOutlinePass checks normal discontinuity and depth discontinuity
**separately** with independent thresholds, using a binary edge-or-not check
(not a Sobel convolution).

Screen-space constant-pixel-width thickness: `clip.xy += viewNormal.xy * uThickness * clip.w`.

Dither fade (opt-in): `new InvertedHullMaterial(thickness, true)` /
`addOutline(mesh, thickness, true)` adds a per-material `uFade` uniform
(default 1 = solid) and a Bayer-dither discard from `src/materials/fade.ts`,
so the hull dissolves in step with its fading parent mesh instead of popping
at full black. Streamed dressing bundles drive it; the default (no fade)
fragment is byte-identical to the pre-fade shader.

# Examples

```glsl
// PostOutlinePass edge detection sketch
// Normal discontinuity
float normalDiff = length(normalCenter - normalSample);
float normalEdge = step(uNormalThreshold, normalDiff);

// Depth discontinuity
float depthDiff = abs(depthCenter - depthSample);
float depthEdge = step(uDepthThreshold, depthDiff);

// Binary edge (either normal OR depth crosses threshold)
float edge = max(normalEdge, depthEdge);
```

# Citations

- [CelMaterial](/materials/cel-material.md)
- [Render Layers](/conventions/render-layers.md)
- [Renderer](/core/renderer.md)
