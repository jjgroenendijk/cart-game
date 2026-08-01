---
type: Reference
title: Three.js
description: "Three.js 0.185: EffectComposer, ShaderMaterial, InstancedMesh, layer-based rendering."
tags: [reference, threejs, rendering]
timestamp: 2026-07-29T21:18:26Z
---

# Schema

Three.js 0.185 is the rendering engine for game-cart.

| Feature            | Usage                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `EffectComposer`   | Single `RenderPass` for all layers; layers set via Three.js         |
|                    | `Layers` on objects + `camera.layers.enable()` (see below)          |
| `ShaderMaterial`   | Custom cel shading, water, sky posterize                            |
| `InstancedMesh`    | Large prop counts (rocks, trees, grass clusters)                    |
| `Points`           | Weather particles, VFX particles                                    |
| `DepthCapturePass` | Layers-0+1 `RGBADepthPacking` capture (mask 0b011) into RGBA8       |
| `OutputPass`       | ACES filmic tone mapping + sRGB output                              |
| `SkyPosterizePass` | Custom pass: synthetic zenith-to-horizon cel gradient, post-tonemap |

# Examples

```ts
// buildComposerSlot() (src/core/composerSlot.ts) — actual composer pass chain
composer.addPass(renderPass); // RenderPass: full scene (all layers), LINEAR
composer.addPass(depthCapture); // DepthCapturePass (shared layers-0+1 depth, needsSwap=false)
composer.addPass(normalCapture); // NormalCapturePass (235 shared view-space normals)
composer.addPass(ao); // AmbientOcclusionPass (235 GTAO; LINEAR pre-tonemap; tier/setting-gated)
composer.addPass(smaa); // SMAAPass (232 edge AA; LINEAR pre-tonemap; tier-gated)
composer.addPass(new OutputPass()); // OutputPass (ACES + sRGB)
composer.addPass(skyPosterize); // SkyPosterizePass (sky + grade + sun effects; post-tonemap)
composer.addPass(groundMist); // GroundMistPass (228 valley mist; post-tonemap)

// Layers are assigned on scene objects, not the composer:
// Layer 0 (default): kart, props, VFX, clouds, dynamic-sky stars/moon, sun disc
// Layer 1: terrain chunks, water, skid marks, track decals
// Layer 2: Preetham sky dome only
// Camera enables layers: camera.layers.enable(1); camera.layers.enable(2);
// DepthCapturePass captures shared layers 0+1 packed depth (mask 0b011);
// consumers read tDepth via unpackRGBAToDepth for the sky mask/AO/mist.
```

# Citations

- [Render Layers](/conventions/render-layers.md)
- [CelMaterial](/materials/cel-material.md)
- [Renderer](/core/renderer.md)

**Testing**: Tests run under jsdom, no WebGL. Export WebGL-free pure
helpers; avoid `THREE.Vector3` in logic that can use plain types.
