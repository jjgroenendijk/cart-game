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

The same pass also carries the 159 sun light effects (halo, god rays, lens
flare). `applyDayCycle()` resolves the shared day-phase glow weight
(`glowIntensity`) + sRGB sun tint once per frame; the per-view render loop then
calls `applySunEffects` (`src/materials/sunEffects.ts`) per slot, projecting the
sun for THAT camera (split-screen halves differ) and writing per-effect gains.
Gains are `effectGain(tierStrength, userEnabled, glow)` — user toggles arrive
via `setEffects()` (from `Game.applyEffectSettings` <- `GameFlow.applySettings`)
and tier strengths via `setQuality()`. All gains 0 (or sun down / behind
camera) -> the pass is a byte-identical no-op. See
[Sun Light Effects](/materials/sun-effects.md).

## Shadow Target

The directional light uses one fixed orthographic shadow camera
(`setQuality` sets `left/right/top/bottom` to `+-shadowHalfExtent`; 60 m low,
80 m med/high). `setShadowTarget(x, z)` slides that box around a world focus,
re-placing the light along the shared sun direction so shadows stay aligned
with the visible sun.

Invariant (224): the shadow volume follows the active rendered view's focus in
every game state, not only racing. `Game.frame` computes one focus per frame —
`menuFocusX/menuFocusZ` for menu/select/countdown (the MenuCamera view), the
human midpoint for racing/paused — and routes it to both `env.update` and
`setShadowTarget` from the same values. `buildWorld` reapplies the fresh menu
focus on every (re)build so a target from the previous world never lingers.
Without this the fixed box stays at a stale focus and its projection edge shows
as a hard, straight shadow cutoff on camera-facing terrain in menu views.
Enlarging `shadowHalfExtent` is deliberately avoided as a fix — it would drop
texel density at current map sizes. See [Quality](/core/quality.md).

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
