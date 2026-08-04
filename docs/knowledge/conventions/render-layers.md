---
type: Convention
title: EffectComposer Render Layers
description: "Four-layer pipeline: solids, terrain, sky dome, selective-bloom emitters."
tags: [rendering, convention]
timestamp: 2026-08-04T06:20:00Z
---

# EffectComposer Render Layers

Four-layer rendering pipeline built on EffectComposer slots. The default camera
enables layer 0 implicitly plus layers 1 and 2 explicitly (`src/core/Renderer.ts`).

| Layer | Content                                                        | Post-Pass |
| ----- | -------------------------------------------------------------- | --------- |
| 0     | Kart, props, VFX; clouds; sky stars/moon; sun disc             | None      |
| 1     | Terrain, water, skid marks, track decals                       | None      |
| 2     | Preetham sky dome                                              | Posterize |
| 3     | Selective-bloom emitters (sun disc; snow sparkle; water glint) | Emissive  |

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
scene-wide threshold bloom (#310).

Two emitter shapes:

- **Same-mesh dual-layer** (Stage 1): the sun disc is itself a pure emitter, so
  `SunDisc` does `layers.set(0)` + `layers.enable(3)` and the SAME material
  renders in both passes.
- **Sibling-clone** (Stage 2, #315): snow sparkle + water glint are per-pixel
  terms computed INSIDE `CelMaterial` / `celWater` and folded into the surface
  albedo/color — not separable objects, and their main material is not a pure
  emitter (it shades the whole surface). So each snow/water mesh gets a
  layer-3-ONLY sibling clone sharing its geometry but wearing an
  `EMISSIVE_OUTPUT` material variant (`CelMaterial`/`CelWaterMaterial` with
  `emissiveOutput:true`) that emits ONLY the glint term (black elsewhere). The
  clone's `layers.set(EMISSIVE_LAYER)` alone makes the main RenderPass skip it;
  only `EmissiveCapturePass` draws it. Uniforms are shared by-ref (light + snow
  singletons, plus `uFade`/`uGlintIntensity`/`uTime` aliased per-instance) so
  per-frame writes fan out and the bloom halo tracks the visible glints exactly.

Stage 2 is tier-gated: clones exist only on med/high. Low tier (bloom off via
`bloomStrength=0`) adds/removes them on the existing `setQuality` hooks
(`TerrainChunkManager`, `WaterChunkManager.setGlintIntensity`,
`DressingChunkManager.setQuality` -> `PropField.setEmissiveClones`) so low pays
no extra layer-3 draw.

- Sun disc (`src/environment/SunDisc.ts`, `EMISSIVE_LAYER=3` enabled in addition to layer 0)
- Snow terrain sparkle clones (`src/terrain/TerrainChunkManager.ts`; near chunks only)
- Snow big-prop sparkle clones (`src/environment/PropField.ts`; big buckets)
- Water sun-glint clones (`src/environment/WaterChunkManager.ts`; tiles, not farSkirt)

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
