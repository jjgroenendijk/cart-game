---
type: DataFlow
title: Rendering Pipeline
description: End-to-end render flow from heightmap sampling through EffectComposer layers to screen.
tags: [rendering, pipeline]
timestamp: 2026-07-17T00:00:00Z
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
  renderPass --> depthCapture[DepthCapturePass shared layers 0+1 depth]
  renderPass --> output[OutputPass ACES sRGB]
  depthCapture --> posterize
  output --> posterize[SkyPosterizePass]
  posterize --> mist[GroundMistPass height mist]
  depthCapture --> mist
  mist --> screen[screen]
```

The single `RenderPass` renders all scene layers (0, 1, 2) at once into a
HalfFloat LINEAR buffer. Layers are on scene objects via `.layers.set(N)`.
Camera enables layers 1 and 2 explicitly: `camera.layers.enable(1)`;
`camera.layers.enable(2)`.

`SkyPosterizePass` runs after OutputPass (post-tonemap sRGB), applying a
synthetic zenith-to-horizon gradient with cel banding over sky pixels, then
a uniform day-phase color grade + corner vignette over ALL pixels.

Sky-mask depth: the sky mask needs layers-0+1 depth (sky = the cleared far
plane where no non-sky geometry drew). Depth is no longer self-captured by
`SkyPosterizePass`; a shared `DepthCapturePass` (`src/materials/depthCapture.ts`,
`needsSwap=false`) captures the combined layers 0+1 (solid props/karts/weather +
terrain/walls/water) ONCE per slot in a single depth-only render over
`nonSkyLayersMask = 0b011` (opaque override material) into a shared
`DepthTexture`. `SkyPosterizePass`'s `sceneDepth(uv)`/`tDepth` reads that one
shared buffer; sky (layer 2, excluded) stays at the cleared depth 1.0 so it
masks in for the gradient. `GroundMistPass` now reads that same single shared
buffer too: it unprojects depth to world altitude and composites height-based
valley mist AFTER `SkyPosterizePass` (the topmost atmosphere layer; see
[Ground Mist](/materials/ground-mist.md)). The remaining future depth-consuming
realism passes (ambient occlusion, far-field DoF, soft particles, water
reflections) read the same single buffer rather than each capturing its own. Weather (layer 0,
`depthWrite:false` in the main color pass) still writes depth in this shared
capture via the opaque override material, so it stays non-sky and does not
receive the gradient. The shared depth RT resizes in `ensureSlot` (via
`composer.setSize`). The buffer is depth-only for now; MRT view-space normals are
deferred until a consumer (AO/edge-AA) needs them.
The grade + vignette are resolved once per frame by
`Renderer.applyDayCycle` from `dayCycleState.cycleT` (pure math in
`src/materials/postGrade.ts`) and fanned to each view slot; a
`postGradeStrength` quality knob scales them (full on all tiers).

The `SkyPosterizePass` mask runs in every game state. `Renderer.renderViews`
always enables it, so the menu, select, countdown, and paused screens share the
gameplay backdrop. Without the posterize pass the raw Preetham `Sky` dome
tone-maps (ACES, exposure 1.0) to a near-white wash; running it everywhere keeps
the gradient sky consistent.

`Renderer.applyDayCycle` writes the per-frame linear fog (color/near/far from
`dayCycleState`), then caps near/far to the bounded terrain square via
`scaleFogToWorld(near, far, worldHalfExtent, FOG_EDGE_MARGIN)`. Game sets
`renderer.worldHalfExtent = circuit.worldSize / 2` on field build. The cap only
shrinks the range when the world is smaller than the day-cycle fog far, so
distant terrain hazes out at its boundary instead of ending in a hard edge
against the sky; larger worlds keep their fog unchanged. `near` scales by the
same factor to preserve the gradient shape.

Both `CelMaterial` (terrain/props/clouds) and `celWater` apply this scene fog
(`USE_FOG` block, default on for cel), so distant world geometry mixes toward
the fog colour — the horizon sky band — as it recedes. For fog to hide the
terrain edge, terrain must actually be present out to where fog saturates. So
`Game.buildWorld` scales the terrain stream/cull radii to the world:
`streamRadius = clamp(worldSize/2, 140, 360)`, `cullRadius =
clamp(worldSize/2 + 30, 170, 390)` (day fog-far peaks at 360). Terrain then
streams into the haze and the cull boundary is invisible, rather than culling at
a fixed 170 m — well inside the fog range — which left a visible ground cutoff
(most obvious under the orbiting menu camera). The cap bounds the per-chunk
trimesh-collider ring the largest worlds seed at load; small worlds keep the
compact default. Clouds get the same treatment via `Environment.worldHalfExtent`
(see [Clouds](/environment/clouds.md)). `terrain.streamRadius`/`cullRadius`
overrides still win.

Layers are defined in the [render-layers convention](/conventions/render-layers.md).
Shared lighting originates from [lightUniforms](/materials/cel-material.md).
The pipeline is owned by [Renderer](/core/renderer.md).

## Tests

Tests assert shader source, uniform defaults, and render-target structure.
Tests run under jsdom, no WebGL. Export WebGL-free pure helpers for unit
tests.
