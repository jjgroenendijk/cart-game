---
type: Shader
title: Outlines
description: Inverted-hull outline for solid geometry (karts + props).
tags: [materials, shader, outline]
timestamp: 2026-07-08T00:00:00Z
---

# Schema

Inverted-hull outline for cel-style rendering. Only solid geometry (layer 0)
gets a toon outline; large surfaces (terrain, walls) rely on cel banding
alone — the former terrain Sobel edge pass was retired (074).

| Technique     | Layer | Target         | Method                                  |
| ------------- | ----- | -------------- | --------------------------------------- |
| Inverted-hull | 0     | Solid geometry | Scaled hull, back-face culling reversed |

`InvertedHullMaterial` uses `side: THREE.BackSide` — front faces are culled,
back faces are rendered (back-face culling reversed). Helper functions:
`addOutline(mesh)` adds an outline child mesh; `removeOutline(mesh)` removes it.

Screen-space constant-pixel-width thickness: `clip.xy += viewNormal.xy * uThickness * clip.w`.

# Examples

```glsl
// Inverted-hull shell: expand along view-space normal in clip space.
// Front faces are culled, so only the extruded back rim reads as the line.
clip.xy += viewNormal.xy * uThickness * clip.w;
```

# Citations

- [CelMaterial](/materials/cel-material.md)
- [Render Layers](/conventions/render-layers.md)
- [Renderer](/core/renderer.md)
