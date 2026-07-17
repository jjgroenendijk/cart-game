---
type: Shader
title: Outlines
description: Post-process edge detection for terrain.
tags: [materials, shader, outline]
timestamp: 2026-07-17T00:00:00Z
---

# Schema

Post-process edge detection for cel-style terrain rendering.

| Technique       | Layer | Target  | Method                             |
| --------------- | ----- | ------- | ---------------------------------- |
| PostOutlinePass | 1     | Terrain | Normal + depth discontinuity check |

Solid geometry (karts, props, dressing) carries no outline: the realism art
direction dropped the black inverted-hull silhouette shells.

PostOutlinePass checks normal discontinuity and depth discontinuity
**separately** with independent thresholds, using a binary edge-or-not check
(not a Sobel convolution).

Its layer-1 depth RT (`normalDepthRT.depthTexture`) is also reused by
`SkyPosterizePass` for its sky mask (039), so terrain depth is rendered once
per view rather than by both mask passes. See
[Rendering Pipeline](/data-flows/render-pipeline.md).

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
