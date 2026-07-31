---
type: System
title: Renderer
description: Three.js EffectComposer with 3 render layers, ACES tone mapping, and shadow management.
tags: [rendering, threejs, core]
timestamp: 2026-07-31T12:00:00Z
---

# Renderer

Owns the EffectComposer with 3 layers per the [render-layers
convention](/conventions/render-layers.md).

Applies day-cycle lighting once per frame, then writes view-dependent
[lightUniforms](/materials/cel-material.md) per rendered camera. Materials read
uniforms by ref. OutputPass applies ACES + sRGB once before sky posterization.

Applies quality tier settings (pixelRatio, shadow extents) via `setQuality`.
The composer slot receives the same `setPixelRatio` update because
EffectComposer captures DPR at construction; this keeps every color/depth/
normal target aligned after a runtime quality change.
Reads `renderer.info` for [StatsHud](/ui/overlays.md).

## Schema

| Layer | Content            | Post-processing            |
| ----- | ------------------ | -------------------------- |
| 0     | Solid kart + props | None                       |
| 1     | Terrain, walls     | None                       |
| 2     | Sky (flat)         | Posterize (post-ACES+sRGB) |

OutputPass (ACES + sRGB) is common to all layers. The per-slot composer chain is
RenderPass -> DepthCapturePass -> NormalCapturePass -> AmbientOcclusionPass ->
SMAAPass -> OutputPass -> SkyPosterizePass: DepthCapturePass
(`src/materials/depthCapture.ts`, `needsSwap=false`) captures the shared
layers-0+1 depth (`nonSkyLayersMask = 0b011`) once per render before OutputPass.
It uses instancing-aware `MeshDepthMaterial` + `RGBADepthPacking` into a
portable RGBA8 color RT rather than a native sampleable depth attachment; all
depth consumers unpack `tDepth` with Three's `unpackRGBAToDepth`.
NormalCapturePass likewise uses `MeshNormalMaterial` + RGBA8 so instanced
positions/normals are correct on Chrome and Safari. `SMAAPass` (232) runs in LINEAR
sRGB before `OutputPass` (three.js requirement), smoothing edges on the final
pre-tonemap image, and is tier-gated by the `smaa` knob via `pass.enabled`.
SkyPosterizePass runs AFTER
OutputPass, snapping already-tonemapped sky pixels into bands and applying a
uniform day-phase grade + corner vignette. `applyDayCycle()` resolves
the grade once per frame from `dayCycleState.cycleT` via the pure
`computePostGrade` helper in `src/materials/postGrade.ts` and fans it to each
slot's SkyPosterizePass (same fan-out shape as the zenith/horizon tints).
`applyDayCycle()` also writes `renderer.toneMappingExposure =
dayCycleState.exposure` each frame (per-phase exposure from the 8-key
day-cycle table; noon 1.0, golden ~1.05, blue hour ~0.95, night ~0.9). The
grade is tier-gated by `postGradeStrength` (full on all tiers; near-free
ALU). Per `renderView()`, kart LOD (`applyKartLod`) and terrain LOD
(`applyTerrainLod`) are applied once per frame from the active camera's
position before the single view renders.

The same pass also carries the 159 sun light effects (halo, god rays, lens
flare). `applyDayCycle()` resolves the shared day-phase glow weight
(`glowIntensity`) + sRGB sun tint once per frame; `renderView` then
calls `applySunEffects` (`src/materials/sunEffects.ts`) for the slot, projecting
the sun for that slot's camera and writing per-effect gains.
Gains are `effectGain(tierStrength, userEnabled, glow)` — user toggles arrive
via `setEffects()` (from `Game.applyEffectSettings` <- `GameFlow.applySettings`)
and tier strengths via `setQuality()`. All gains 0 (or sun down / behind
camera) -> the pass is a byte-identical no-op. See
[Sun Light Effects](/materials/sun-effects.md).

## Module Layout

`src/core/Renderer.ts` owns the EffectComposer pipeline, day-cycle fan-out,
quality tier, shadow target, fog/world clamping, kart + terrain LOD passes,
and the 228 ground-mist pass. Three siblings keep it under the file cap with
no behavior change:

- `src/core/composerSlot.ts` — `ComposerSlot` interface + the
  `buildComposerSlot` factory that constructs the EffectComposer chain
  (RenderPass -> DepthCapture -> NormalCapture -> AO -> SMAA -> OutputPass ->
  SkyPosterize -> GroundMist). `Renderer.ensureSlot` calls it; Renderer owns the
  single slot + per-frame camera/uniform rebind. Holds the 232 SMAAPass insert.
- `src/core/frameStats.ts` — `FrameStatsSampler` (the `FrameStats` shape +
  the per-frame `renderer.info` copy); `Renderer.getFrameStats()` returns
  its retained sample. `FrameStats` is re-exported from `Renderer.ts`.
- `src/core/sunFxState.ts` — `SunFxState` (159 sun-effect user enables +
  tier strengths, the once-per-frame glow weight + sRGB sun tint, and the
  `apply` that binds them to a SkyPosterizePass).
  `Renderer.applyDayCycle` resolves the frame, `renderView` calls `apply`
  for the slot, and `groundMistEnabled()` gates the 228 mist strength scalar
  (the mist pass itself stays in Renderer).

## Shadow Target

Two cascades: a tight NEAR ortho box (`sun`, sharp contact shadows) and a
wide FAR box (`sunFar`, 144, soft middle-distance coverage). `setQuality`
sets each box's `left/right/top/bottom` to `+-halfExtent`.

Near: `shadowHalfExtent` 60 m low / 40 m med/high. Far (NEW, 144):
`farShadowHalfExtent` 200 m, med/high only — wide enough to cover the
middle distance to the terrain draw range so distant trees at ~150 m cast.
The pre-144 "enlarging `shadowHalfExtent`" idea is now superseded: it
would drop texel density, and the far cascade is the real fix for the
unshadowed middle distance. Both lights (`sun` near, `sunFar` far) are
shadow-cast directional lights; `sunFar` is SHADOW-ONLY (intensity 0,
black color — CelMaterial does custom lighting and ignores three's
per-light color accumulation, so it reads only the shadow uniforms).

Cascade selection: the cel fragment blends near -> far by view distance
across a band ending at `cascadeSplit` (40 m) of width `cascadeBlendWidth`
(8 m), driven by the shared `uCascadeSplit` uniform (Renderer writes it
from the tier knobs), mirroring the pure `cascadeBlendWeight` in
`core/shadowCascade.ts`. Both lights follow the active view focus via
`setShadowTarget(x, z)`, which re-places each light along the shared sun
direction (same distance, same target offset) so shadows stay aligned with
the visible sun. Low tier = far OFF (`sunFar.castShadow = false` ->
`NUM_DIR_LIGHT_SHADOWS` stays 1) = single near box, byte-identical to
pre-144.

Invariant (224): the shadow volume follows the active rendered view's focus in
every game state, not only racing. `Game.frame` computes one focus per frame —
`menuFocusX/menuFocusZ` for menu/select/countdown (the MenuCamera view), the
human midpoint for racing/paused — and routes it to both `env.update` and
`setShadowTarget` from the same values. `buildWorld` reapplies the fresh menu
focus on every (re)build so a target from the previous world never lingers.
Without this the fixed box stays at a stale focus and its projection edge shows
as a hard, straight shadow cutoff on camera-facing terrain in menu views.
See [Quality](/core/quality.md).

## Shadow Fade

`applyDayCycle` writes `uShadowFade.value = dayCycleState.shadowFade`
and toggles `castShadow` via `shadowCastsFromFade(fade)` (on when fade >
0, off at 0). `sunFar` is gated the same way AND by the tier flag
`farCascade` (`sunFar.castShadow = farCascade && shadowCastsFromFade(fade)`).
`shadowFade` is an elevation-driven smoothstep over a
3-18 deg band (`SHADOW_FADE_LOW=3`, `SHADOW_FADE_HIGH=18`), symmetric
at dawn/dusk. The shadow map stays alive across the band — no teardown
or material recompile mid-transition; recompiles only when crossing to
fade 0 (deep night) or back. Both lights off at fade 0 -> `NUM_DIR_LIGHT_SHADOWS`
0 -> shadowless recompile, unchanged night behavior vs pre-144.

Both cascades render every frame in v1. A ready profiling fallback (NOT
shipped): refresh the far depth map every other frame (step 2) if the far
pass exceeds the med budget — a future knob, not a current behavior.

## Citations

- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
- [Render Pipeline](/data-flows/render-pipeline.md)

## Source Links

- `src/core/Renderer.ts` — EffectComposer owner; day-cycle + LOD + mist passes
- `src/core/shadowCascade.ts` — 144 pure near->far cascade blend weight helper
- `src/core/frameStats.ts` — `FrameStatsSampler` + `FrameStats` shape
- `src/core/sunFxState.ts` — `SunFxState` per-frame sun-effect resolve/apply
