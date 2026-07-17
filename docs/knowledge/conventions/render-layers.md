---
type: Convention
title: EffectComposer Render Layers
description: "Three-layer rendering pipeline: default solids, terrain, sky dome."
tags: [rendering, convention]
timestamp: 2026-07-17T00:00:00Z
---

# EffectComposer Render Layers

Three-layer rendering pipeline built on EffectComposer slots. The default camera
enables layer 0 implicitly plus layers 1 and 2 explicitly (`src/core/Renderer.ts`).

| Layer | Content                                            | Post-Pass |
| ----- | -------------------------------------------------- | --------- |
| 0     | Kart, props, VFX; clouds; sky stars/moon; sun disc | None      |
| 1     | Terrain, water, skid marks, track decals           | None      |
| 2     | Preetham sky dome                                  | Posterize |

## Layer 0 — Default Solids

Drawn by the default render pass; no EffectComposer pre-pass. Karts and props
carry no outline — the cel-era inverted-hull silhouette shells were removed for
the realism art direction.

- Kart + props + VFX (default layer)
- Clouds (`src/environment/Clouds.ts`, `CLOUD_LAYER=0`)
- Dynamic-sky stars and moon (`src/environment/DynamicSky.ts`, `SKY_LAYER=0`)
- Sun disc (`src/environment/SunDisc.ts`, `SUN_DISC_LAYER=0`)
- Track gantries (`src/environment/TrackDressing.ts`, `GANTRY_LAYER=0`)

## Layer 1 — Terrain

Layer 1 carries no outline post-pass. Its depth is captured (together with
layer 0) by `SkyPosterizePass`'s own combined depth pre-pass (`nonSkyLayersMask
= 0b011`) so terrain reads as non-sky for the sky mask + god rays. Boundary
walls are gone — the kart roams past the old world (`src/terrain/Terrain.ts`).

- Terrain chunks (`src/terrain/TerrainChunkManager.ts`, `TERRAIN_LAYER=1`)
- Water tiles (`src/environment/WaterChunkManager.ts`, `WATER_LAYER=1`)
- Skid marks (`src/kart/SkidMarksLayer.ts`, `SKID_LAYER=1`)
- Track decals (`src/environment/TrackDressing.ts`, `DECAL_LAYER=1`)

## Layer 2 — Sky Dome

Only the Preetham sky dome (`src/core/Renderer.ts`, `sky.layers.set(2)`).

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
