---
type: Reference
title: Three.js
description: "Three.js 0.184: EffectComposer, ShaderMaterial, InstancedMesh, layer-based rendering."
tags: [reference, threejs, rendering]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Three.js 0.184 is the rendering engine for game-cart.

| Feature          | Usage                                                                |
| ---------------- | -------------------------------------------------------------------- |
| `EffectComposer` | 3 render layers (see [render-layers](/conventions/render-layers.md)) |
| `ShaderMaterial` | Custom cel shading, outlines, water, sky posterize                   |
| `InstancedMesh`  | Large prop counts (rocks, trees, grass clusters)                     |
| `Points`         | Weather particles, VFX particles                                     |
| `OutputPass`     | ACES filmic tone mapping + sRGB output                               |

# Examples

```ts
// Renderer layers
composer.addPass(layer0Pass); // solids + inverted-hull outlines
composer.addPass(layer1Pass); // terrain + cel shading
composer.addPass(layer2Pass); // sky + posterize
composer.addPass(outputPass); // ACES + sRGB
```

# Citations

- [Render Layers](/conventions/render-layers.md)
- [CelMaterial](/materials/cel-material.md)
- [Renderer](/core/renderer.md)

**Testing**: Tests run under jsdom, no WebGL. Export WebGL-free pure
helpers; avoid `THREE.Vector3` in logic that can use plain types.
