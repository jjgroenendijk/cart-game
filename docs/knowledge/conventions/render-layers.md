---
type: Convention
title: EffectComposer Render Layers
description: "Three-layer rendering pipeline: solids, terrain, sky."
tags: [rendering, convention]
timestamp: 2026-07-05T00:00:00Z
---

# EffectComposer Render Layers

Three-layer rendering pipeline built on EffectComposer slots.

| Layer | Content                                    | Post-Pass      |
| ----- | ------------------------------------------ | -------------- |
| 0     | Solid kart + props, inverted-hull outlines | None           |
| 1     | Terrain / walls                            | Sobel outlines |
| 2     | Sky                                        | Posterize      |

## Output

OutputPass applies ACES tone mapping + sRGB conversion once, then
SkyPosterizePass snaps sky pixels into bands after tonemapping. CelMaterial
outputs LINEAR color; any shadow term multiplies diffuse in LINEAR before the
final ACES + sRGB.

## Shared Lighting

`lightUniforms` are shared by reference. Camera-independent values are written
once per frame; the view-space sun direction is written once per rendered view.

## Related

- [Renderer](/core/renderer.md)
