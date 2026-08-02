---
type: Convention
title: EffectComposer Render Layers
description: "Four-layer pipeline: solids, terrain, sky dome, selective-bloom emitters."
tags: [rendering, convention]
timestamp: 2026-08-02T03:30:00Z
---

# EffectComposer Render Layers

Four-layer rendering pipeline built on EffectComposer slots. The default camera
enables layer 0 implicitly plus layers 1 and 2 explicitly (`src/core/Renderer.ts`).

| Layer | Content                                            | Post-Pass |
| ----- | -------------------------------------------------- | --------- |
| 0     | Kart, props, VFX; clouds; sky stars/moon; sun disc | None      |
| 1     | Terrain, water, skid marks, track decals           | None      |
| 2     | Preetham sky dome                                  | Posterize |
| 3     | Selective-bloom emitters (sun disc; future glints) | Emissive  |

## Layer 0 — Default Solids

Drawn by the default render pass; no EffectComposer pre-pass. Karts and props
carry no outline — the cel-era inverted-hull silhouette shells were removed for
the realism art direction.

- Kart + props + VFX (default layer)
- Clouds (`src/environment/Clouds.ts`, `CLOUD_LAYER=0`)
- Dynamic-sky stars and moon (`src/environment/DynamicSky.ts`, `SKY_LAYER=0`)
- Sun disc (`src/environment/SunDisc.ts`, `SUN_DISC_LAYER=0`; also layer 3)
- Track gantries (`src/environment/TrackDressing.ts`, `GANTRY_LAYER=0`)

Depth/normal capture still respects the original material contract inside these
layers: drawables whose materials all set `depthWrite:false` are temporarily
suppressed while the override material renders. Transparent weather/VFX
therefore remain color-only and cannot become opaque particle rectangles in
the sky mask or GTAO inputs.

## Layer 1 — Terrain

Layer 1 carries no outline post-pass. Its depth is captured (together with
layer 0) by the shared `DepthCapturePass` (`src/materials/depthCapture.ts`,
`nonSkyLayersMask = 0b011`) that `SkyPosterizePass` (and future post passes)
read, so terrain reads as non-sky for the sky mask + god rays. A sibling
`NormalCapturePass` (`src/materials/normalCapture.ts`, same mask) renders packed
view-space normals for the GTAO ambient occlusion pass (235). Boundary walls
are gone — the kart roams past the old world (`src/terrain/Terrain.ts`).

- Terrain chunks (`src/terrain/TerrainChunkManager.ts`, `TERRAIN_LAYER=1`)
- Water tiles (`src/environment/WaterChunkManager.ts`, `WATER_LAYER=1`)
- Skid marks (`src/kart/SkidMarksLayer.ts`, `SKID_LAYER=1`)
- Track decals (`src/environment/TrackDressing.ts`, `DECAL_LAYER=1`)

## Layer 2 — Sky Dome

Only the Preetham sky dome (`src/core/Renderer.ts`, `sky.layers.set(2)`).

## Layer 3 — Selective-Bloom Emitters

Genuine HDR emitters that the selective bloom pass bleeds light from. An object
ENABLES layer 3 IN ADDITION to its visible layer, so it draws sharp in the main
RenderPass AND reaches the emissive capture. `EmissiveCapturePass`
(`src/materials/emissiveCapture.ts`, `emissiveLayerMask = 1 << 3`) renders only
layer 3 into a black-cleared HalfFloat RT; `BloomPass` (`src/materials/bloom.ts`)
blurs that and composites the pure bloom over the LINEAR pre-tonemap buffer.

This is what makes the bloom SELECTIVE: the raw sky dome (layer 2) and ordinary
lit surfaces (layers 0/1) never feed the blur — the failure mode of the retired
scene-wide threshold bloom (#310). Stage 1's only emitter is the sun disc; snow
sparkle + water glints are a follow-up.

- Sun disc (`src/environment/SunDisc.ts`, `EMISSIVE_LAYER=3`)

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
