---
type: DataFlow
title: Rendering Pipeline
description: End-to-end render flow from heightmap sampling through EffectComposer layers to screen.
tags: [rendering, pipeline]
timestamp: 2026-07-08T00:00:00Z
---

# Rendering Pipeline

```mermaid
flowchart LR
  height[heightAt x,z] --> mesh[terrain mesh]
  height --> color[terrain vertex colors]
  mesh --> collider[Rapier trimesh collider]
  collider --> suspension[kart suspension raycasts]
  suspension --> kart[kart physics]
  color --> layer1[layer 1 terrain walls]
  light[lightUniforms] --> cel[cel materials]
  cel --> layer0[layer 0 kart props]
  cel --> layer1
  layer0 --> renderPass[RenderPass all layers 0 1 2]
  layer1 --> renderPass
  sky[layer 2 sky] --> renderPass
  renderPass --> bloom[UnrealBloomPass linear HDR]
  bloom --> output[OutputPass ACES sRGB]
  output --> posterize[SkyPosterizePass]
  posterize --> screen[screen]
```

The single `RenderPass` renders all scene layers (0, 1, 2) at once into a
HalfFloat LINEAR buffer. Layers are on scene objects via `.layers.set(N)`.
Camera enables layers 1 and 2 explicitly: `camera.layers.enable(1)`;
`camera.layers.enable(2)`. The composer chain is `RenderPass` ->
`UnrealBloomPass` (linear HDR bloom) -> `OutputPass` (ACES + sRGB) ->
`SkyPosterizePass`.

`UnrealBloomPass` blooms bright highlights (sun-disc core + corona,
water glints, bright sand) in linear HDR before the single ACES
tonemap. It is tier-gated via `QualityKnobs.bloom`
{strength,radius,threshold}: low tier is softer (not off) so cheap cel
colors stay readable.

`SkyPosterizePass` also owns a sun-aware sky halo (074): a radial glow
and brighter hotspot folded into the synthetic sky gradient around the
projected sun screen-uv, sky-masked (terrain/walls occlude via the
existing `tDepth`). It is driven per slot by `Renderer.applySunGlow`
from `dayCycleState` via the pure `projectSunUv` and `glowIntensity`
helpers in `src/materials/sunGlow.ts`; halo intensity scales with the
active bloom strength and fades by `1 - nightFactor`.

`SkyPosterizePass` runs after OutputPass (post-tonemap sRGB), applying a
synthetic zenith-to-horizon gradient with cel banding over sky pixels, then
a uniform day-phase color grade + corner vignette over ALL pixels (064).
The grade + vignette are resolved once per frame by
`Renderer.applyDayCycle` from `dayCycleState.cycleT` (pure math in
`src/materials/postGrade.ts`) and fanned to each view slot; a
`postGradeStrength` quality knob scales them (full on all tiers).

Layers are defined in the [render-layers convention](/conventions/render-layers.md).
Shared lighting originates from [lightUniforms](/materials/cel-material.md).
The pipeline is owned by [Renderer](/core/renderer.md).

## Tests

Tests assert shader source, uniform defaults, and render-target structure.
Tests run under jsdom, no WebGL. Export WebGL-free pure helpers for unit
tests.
