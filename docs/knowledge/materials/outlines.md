---
type: Shader
title: Outlines
description: Inverted-hull outline for solid geometry and post-Sobel edge detection for terrain.
tags: [materials, shader, outline]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Two outline techniques for cel-style rendering.

| Technique       | Layer | Target         | Method                                 |
| --------------- | ----- | -------------- | -------------------------------------- |
| Inverted-hull   | 0     | Solid geometry | Scaled hull, backface culling reversed |
| PostOutlinePass | 1     | Terrain        | Sobel edge detection on render target  |

Inverted-hull renders an enlarged mesh with front-face culling
disabled, outlining solid objects. PostOutlinePass samples the terrain
layer's depth/normal and applies a Sobel kernel for edge detection.

# Examples

```glsl
// PostOutlinePass Sobel kernel sketch
float sobelDepth = abs(depthL + 2.0*depthC + depthR)
                 + abs(depthT + 2.0*depthC + depthB);
float edge = step(uThreshold, sobelDepth);
```

# Citations

- [CelMaterial](/materials/cel-material.md)
- [Render Layers](/conventions/render-layers.md)
- [Renderer](/core/renderer.md)
