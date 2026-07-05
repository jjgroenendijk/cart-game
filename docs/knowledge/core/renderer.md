---
type: System
title: Renderer
description: Three.js EffectComposer with 3 render layers, ACES tone mapping, and shadow management.
tags: [rendering, threejs, core]
timestamp: 2026-07-05T00:00:00Z
---

# Renderer

Owns the EffectComposer with 3 layers per the [render-layers
convention](/conventions/render-layers.md).

Writes [lightUniforms](/materials/cel-material.md) once per frame; all materials
read uniforms by ref. OutputPass applies ACES + sRGB once.

Applies quality tier settings (pixelRatio, shadow extents) via `setQuality`.
Reads `renderer.info` for [StatsHud](/ui/overlays.md).

## Schema

| Layer | Content            | Post-processing       |
| ----- | ------------------ | --------------------- |
| 0     | Solid kart + props | Inverted-hull outline |
| 1     | Terrain, walls     | Sobel outline         |
| 2     | Sky (flat)         | Posterize, ACES+sRGB  |

## Citations

- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
