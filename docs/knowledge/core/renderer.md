---
type: System
title: Renderer
description: Three.js EffectComposer with 3 render layers, ACES tone mapping, and shadow management.
tags: [rendering, threejs, core]
timestamp: 2026-07-05T00:00:00Z
---

# Renderer

Owns the EffectComposer with 3 layers per the [render-layers
convention](/conventions/render-layers.md).

Applies day-cycle lighting once per frame, then writes view-dependent
[lightUniforms](/materials/cel-material.md) per rendered camera. Materials read
uniforms by ref. OutputPass applies ACES + sRGB once before sky posterization.

Applies quality tier settings (pixelRatio, shadow extents) via `setQuality`.
Reads `renderer.info` for [StatsHud](/ui/overlays.md).

## Schema

| Layer | Content            | Post-processing            |
| ----- | ------------------ | -------------------------- |
| 0     | Solid kart + props | Inverted-hull outline      |
| 1     | Terrain, walls     | Sobel outline              |
| 2     | Sky (flat)         | Posterize (post-ACES+sRGB) |

OutputPass (ACES + sRGB) is common to all layers. SkyPosterizePass runs AFTER
OutputPass, snapping already-tonemapped sky pixels into bands and applying a
uniform day-phase grade + corner vignette. `applyDayCycle()` resolves
the grade once per frame from `dayCycleState.cycleT` via the pure
`computePostGrade` helper in `src/materials/postGrade.ts` and fans it to each
slot's SkyPosterizePass (same fan-out shape as the zenith/horizon tints). The
grade is tier-gated by `postGradeStrength` (full on all tiers; near-free
ALU). Per `renderViews()`, kart LOD (`applyKartLod`) and terrain LOD
(`applyTerrainLod`) are applied once per frame from the active cameras'
positions before the per-view render loop.

## Shadow Fade

`applyDayCycle` writes `uShadowFade.value = dayCycleState.shadowFade`
and toggles `castShadow` via `shadowCastsFromFade(fade)` (on when fade >
0, off at 0). `shadowFade` is an elevation-driven smoothstep over a
3-18 deg band (`SHADOW_FADE_LOW=3`, `SHADOW_FADE_HIGH=18`), symmetric
at dawn/dusk. The shadow map stays alive across the band — no teardown
or material recompile mid-transition; recompiles only when crossing to
fade 0 (deep night) or back.

## Citations

- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
