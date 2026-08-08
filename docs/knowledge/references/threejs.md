---
type: Reference
title: Three.js
description: "Three.js 0.185 + postprocessing 6.39: pmndrs EffectComposer pipeline."
tags: [reference, threejs, rendering]
timestamp: 2026-08-08T09:00:00Z
---

# Schema

Three.js 0.185 is the rendering engine for game-cart. Post-processing is built
on the pmndrs `postprocessing` library (v6.39.4, peer-compatible with three
r185) — not the three.js addons.

| Feature             | Usage                                                               |
| ------------------- | ------------------------------------------------------------------- |
| `EffectComposer`    | pmndrs; HalfFloat frame buffers, `frameBufferType` option           |
| `RenderPass`        | pmndrs; full scene (all layers), LINEAR                             |
| `ToneMappingEffect` | ACES filmic tonemap in an EffectPass (replaces three.js OutputPass) |
| `SMAAEffect`        | pmndrs; edge AA in an EffectPass                                    |
| `ShaderMaterial`    | Custom cel shading, water, sky posterize                            |
| `InstancedMesh`     | Large prop counts (rocks, trees, grass clusters)                    |
| `Points`            | Weather particles, VFX particles                                    |
| `DepthCapturePass`  | Layers-0+1 `RGBADepthPacking` capture (mask 0b011) into RGBA8       |
| `BloomPass`         | pmndrs `MipmapBlurPass` on the emissive RT; selective HDR bloom     |
| `SkyPosterizePass`  | Custom pass: synthetic zenith-to-horizon cel gradient, post-tonemap |

# Examples

```ts
// buildComposerSlot() (src/core/composerSlot.ts) — pmndrs composer pass chain
composer.addPass(renderPass); // pmndrs RenderPass: full scene (all layers), LINEAR
composer.addPass(depthCapture); // DepthCapturePass (shared layers-0+1 depth, needsSwap=false)
composer.addPass(normalCapture); // NormalCapturePass (235 shared view-space normals)
composer.addPass(ao); // AmbientOcclusionPass (235 GTAO; LINEAR pre-tonemap; tier/setting-gated)
composer.addPass(smaa); // EffectPass(SMAAEffect) (232 edge AA; LINEAR pre-tonemap; tier-gated)
composer.addPass(emissive); // EmissiveCapturePass (layer-3 emitter RT, needsSwap=false)
composer.addPass(bloom); // BloomPass (MipmapBlurPass on emissive RT; LINEAR pre-tonemap)
composer.addPass(tonemap); // EffectPass(ToneMappingEffect, ACES_FILMIC)
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
