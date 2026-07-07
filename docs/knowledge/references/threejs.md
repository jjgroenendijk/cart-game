---
type: Reference
title: Three.js
description: "Three.js 0.185: EffectComposer, ShaderMaterial, InstancedMesh, layer-based rendering."
tags: [reference, threejs, rendering]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Three.js 0.185 is the rendering engine for game-cart.

| Feature            | Usage                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `EffectComposer`   | Single `RenderPass` for all layers; layers set via Three.js         |
|                    | `Layers` on objects + `camera.layers.enable()` (see below)          |
| `ShaderMaterial`   | Custom cel shading, outlines, water, sky posterize                  |
| `InstancedMesh`    | Large prop counts (rocks, trees, grass clusters)                    |
| `Points`           | Weather particles, VFX particles                                    |
| `OutputPass`       | ACES filmic tone mapping + sRGB output                              |
| `SkyPosterizePass` | Custom pass: synthetic zenith-to-horizon cel gradient, post-tonemap |

# Examples

```ts
// Renderer.buildSlot() — actual composer pass chain
composer.addPass(renderPass); // single RenderPass for full scene (all layers)
composer.addPass(postOutline); // PostOutlinePass (edge detection on layer 1)
composer.addPass(new OutputPass()); // ACES + sRGB
composer.addPass(skyPosterize); // SkyPosterizePass (painted sky gradient)

// Layers are assigned on scene objects, not the composer:
// Layer 0 (default): kart, props, VFX, clouds, dynamic-sky stars/moon, sun disc
// Layer 1: terrain chunks, water, skid marks, track decals (PostOutlinePass
//   renders only this layer)
// Layer 2: Preetham sky dome only
// Camera enables layers: camera.layers.enable(1); camera.layers.enable(2);
```

# Citations

- [Render Layers](/conventions/render-layers.md)
- [CelMaterial](/materials/cel-material.md)
- [Renderer](/core/renderer.md)

**Testing**: Tests run under jsdom, no WebGL. Export WebGL-free pure
helpers; avoid `THREE.Vector3` in logic that can use plain types.
