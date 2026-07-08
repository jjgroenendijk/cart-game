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
`src/materials/sunGlow.ts`; halo intensity scales with the active
`bloomScale` (low tier softer). Bloom is phase-driven, not static:
`applyDayCycle` resolves `bloomForCycleT(cycleT, bloomScale)` once/frame
from `src/materials/postFxPhase.ts` and fans `{strength, radius, threshold}`
per slot (dawn/dusk drop threshold so the low sun glows; day sits high so
only true HDR emitters bloom; night lowest for headlights). `bloomScale`
(0 low, 0.85 med, 1 high) multiplies strength and gates `bloom.enabled`
in `setQuality`; `QualityKnobs.bloom` is now vestigial. The same frame
drives a phase exposure micro-curve via `exposureForCycleT(cycleT)` onto
`renderer.toneMappingExposure` (day +6%, night -8%, dawn/dusk ~neutral).
`buildSlot` seeds UnrealBloomPass with dawn defaults (overwritten first
frame). `threshold` is in raw LINEAR HDR luminance (the buffer pre-tonemap);
bright
tropical cel surfaces reach ~1.8 linear (sand + sun + rim/spec), so threshold
sits at/above ~2.0 to bloom ONLY true HDR emitters. The SunDisc core is
HDR-boosted ×4 (`SUN_CORE_BOOST`) so its luminance (~3.6) clears the
threshold with margin; corona stays at base color as a manual additive glow.
kart LOD (`applyKartLod`) and terrain LOD (`applyTerrainLod`) are applied
once per frame from the active cameras' positions before the per-view render
loop.

## Citations

- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
