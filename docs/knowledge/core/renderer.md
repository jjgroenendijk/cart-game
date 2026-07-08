---
type: System
title: Renderer
description: Three.js EffectComposer with 3 render layers, ACES tone mapping, and shadow management.
tags: [rendering, threejs, core]
timestamp: 2026-07-08T00:00:00Z
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
| 1     | Terrain, walls     | None (drawn by RenderPass) |
| 2     | Sky (flat)         | Posterize (post-ACES+sRGB) |

The per-slot composer chain is `RenderPass` -> `UnrealBloomPass` (linear HDR
bloom on bright highlights, before the single ACES tonemap in OutputPass) ->
`OutputPass` (ACES + sRGB) -> `SkyPosterizePass`. Layer 1 (terrain/walls)
renders into the main RenderPass like every other layer; the former separate
terrain Sobel edge pass was retired (074). OutputPass is common to all
layers. SkyPosterizePass runs AFTER OutputPass, snapping already-tonemapped
sky pixels into bands and applying a uniform day-phase grade + corner
vignette (064). `applyDayCycle()` resolves the grade once per frame from
`dayCycleState.cycleT` via the pure `computePostGrade` helper in
`src/materials/postGrade.ts` and fans it to each slot's SkyPosterizePass
(same fan-out shape as the zenith/horizon tints). The grade is tier-gated by
`postGradeStrength` (full on all tiers; near-free ALU). Per `renderViews()`,
`applySunGlow()` drives the sun halo per slot from `dayCycleState`
(sun-uv projection, elevation/intensity/night-driven glow intensity, sRGB
sun color) via the pure `projectSunUv` + `glowIntensity` helpers in
`src/materials/sunGlow.ts`; halo intensity scales with the active bloom
strength (low tier softer). Quality tiers carry bloom
{strength,radius,threshold} via `QualityKnobs.bloom`, applied in `setQuality`.
`threshold` is in raw LINEAR HDR units (the buffer pre-tonemap), so it sits
at/above ~1.0 to bloom ONLY true HDR highlights (sun core, water glints,
specular); a sub-1.0 threshold blooms ordinary lit cel surfaces and washes
the frame white.
kart LOD (`applyKartLod`) and terrain LOD (`applyTerrainLod`) are applied
once per frame from the active cameras' positions before the per-view render
loop.

## Citations

- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
