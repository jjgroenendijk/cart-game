---
type: System
title: Ground Mist
description: Screen-space height-based valley mist; dawn/dusk-peaked, fog-tinted, tier-gated.
tags: [materials, rendering, post-processing, atmosphere]
timestamp: 2026-07-29T21:18:26Z
---

# Ground Mist

Ground mist for the Painted Wilds atmosphere law: pools in valleys and basins,
thins with altitude, densest at dawn and dusk, tinted from the current fog
colour. A screen-space HEIGHT-BASED post pass reads the shared `DepthCapturePass`
depth and reconstructs world altitude per pixel — explicitly NOT a volumetric
raymarch, so there is no per-ray cost and the look holds 60fps on every tier.

The master gain `uMistStrength` defaults to 0, so the unwired pass is
byte-identical to the pre-feature frame. The quality tier scales it (off on
low); a Settings toggle drives it to 0 to disable; the dawn/dusk time factor
fades it to nothing at night.

## Technique

Per pixel, inside one full-screen fragment over the already-graded + vigetted
frame:

- Sky skip: depth == 1.0 (cleared far plane, no non-sky geometry) returns the
  pixel unchanged — mist never paints the sky.
- Depth to world: unproject `tDepth` via `uInvViewProj`
  (`camera.matrixWorld * camera.projectionMatrixInverse`, derived per view) to a
  world position; `uCamPos` is the same camera origin.
- Altitude falloff: smoothstep over the `poolY`/`thinY` band — densest at or
  below `poolY=-6`, thins to 0 by `thinY=+2`. The band is chosen so the
  track/kart corridor at Y≈[-2,+5] clears; mist reads as basin pools, not a
  flat wash over the course.
- Near-distance fade: 0 within 10 m of the camera, ramping to 1 beyond 30 m, so
  nearby karts and track are never hidden behind their own mist.
- fbm drift: 3 octaves (`MIST_OCTAVES`) of value noise on world XZ, scrolling
  with `uTime`, for slow drifting pools instead of a static layer.
- Time factor: density multiplied by `uTimeFactor` from `mistTimeFactor`
  (dawn/dusk peak, 0 at night, 0.35 midday floor, 1 at horizon).
- Wetness boost: density scaled by `mistWetnessBoost` = `1 + 0.6 * wetness`, so
  rain/storm presets thicken the mist (~1.6x at wetness 1).
- Composite: the density term lerps the pixel toward `uFogColor` (post-tonemap
  sRGB); the whole contribution is then scaled by `uMistStrength`.

On terrain pixels the reconstructed world Y equals `heightAt` by construction
(the terrain mesh verts are built from `heightAt`), so mist pools exactly
where the terrain is low — without the shader ever calling `heightAt` (CPU-only
in the terrain pipeline) or touching the Rapier trimesh collider. Invariant
(mirrors the terrain surface-detail rule): mist is shading/post-only.
`heightAt`, the terrain mesh, and the trimesh collider are untouched; the
off-path (strength 0) fragment is byte-identical to the pre-feature frame.

## Pure math (`src/materials/groundMistMath.ts`)

WebGL-free helpers the Renderer calls per frame (jsdom-tested):

- `hash2`/`vnoise`/`fbm`: value-noise primitives mirrored bit-for-bit into GLSL
  by `MIST_NOISE_FN`, so CPU-side density previews match the shader.
- `MIST_NOISE_FN`: the GLSL source string (hash2 + vnoise + fbm) injected into
  the fragment, kept in sync with the TS mirror by unit test.
- `mistTimeFactor(elevDeg, nightFactor)`: the dawn/dusk curve — 0 at night,
  0.35 midday floor, 1 at the horizon — so mist is densest at the low-sun rake
  and absent after dark.
- `mistWetnessBoost(wetness)`: `1 + 0.6 * wetness`; humidity proxy from the
  shared wetness channel.
- `DEFAULT_MIST_PARAMS`/`GroundMistParams`: the knob struct (`poolY`, `thinY`,
  near/far fade, octaves, fbm scale/scroll) with stable defaults.

## Shader (`src/materials/groundMist.ts`)

`GroundMistPass extends Pass` runs AFTER `SkyPosterizePass` — the last pass,
compositing as the topmost atmosphere layer over the already-graded +
vigetted frame (`needsSwap = true`). Uniforms:

- `tColor`: input frame (post SkyPosterize).
- `tDepth`: the shared `DepthCapturePass` RGBA8 packed-depth texture (combined
  layers 0+1; white unpacks to the far plane 1.0). The shader uses
  `unpackRGBAToDepth`; no native depth attachment is sampled.
- `uInvViewProj`, `uCamPos`: per-view camera inverse view-projection and origin.
- `uMistStrength`: master gain; 0 -> identity early-out (the fragment returns
  `tColor` unchanged before any unproject/noise work).
- `uFogColor`: post-tonemap sRGB fog tint.
- `uTimeFactor`, `uWetness`, `uTime`: per-frame mood + drift inputs.
- The `GroundMistParams` knobs (`poolY`, `thinY`, near/far fade, scale/scroll).

The `MIST_OCTAVES` define sets the fbm octave count (3). `setMist(...)`
writes the mood uniforms in one call. The pass rebinds `camera` per view (like
`DepthCapturePass.camera`) and derives `uInvViewProj` + `uCamPos` in its
`render()`, so multi-slot views reconstruct world space correctly.

## Mood inputs

Mist inherits the biome and weather mood for free through three inputs:

- Tint: `dayCycleState.fogColor`, which already stacks the sky colour, the
  biome `skyFogBias.fogTint`, and the weather `patchFog`. Renderer resolves it
  linear -> sRGB (mirrors the sun-colour handling for post-tonemap sRGB)
  before writing `uFogColor`.
- Time factor: `mistTimeFactor(dayCycleState.sunElevationDeg,
dayCycleState.nightFactor)` -> densest at dawn/dusk, thin midday, none at
  night.
- Humidity: the shared `wetness` channel (written by Environment each frame;
  rain/storm presets -> wetness 1 -> ~1.6x mist).

So a cold tundra dawn reads as cold mist and a stormy temperate noon reads as
thick humid haze, all through one shader and the existing fog register. This
is the height-based / volumetric mist clause of the atmosphere law
([Art Direction](/conventions/art-direction.md)).

## Settings + tiers

User toggle: `EffectSettings.groundMist` (boolean, default ON) in
`src/core/settings.ts`, applied via `Renderer.setEffects` and exposed as a
`SettingsOverlay` row.

Quality tier: `QualityKnobs.groundMistStrength` — low 0 (off, identity),
med 0.5, high 1.0 — mirrors the `waterGlintIntensity: 0`-on-low precedent.
Forwarded in `Renderer.setQuality`.

Final shader gain: `uMistStrength = groundMistStrength (tier) * (enabled ?
1 : 0)`. The time factor and wetness boost are multiplied INSIDE the shader,
so the master gain stays the single identity gate: at 0 the fragment returns
`tColor` unchanged. Low tier is OFF (cheaper); med/high ON.

## Citations

- [Render Pipeline](/data-flows/render-pipeline.md)
- [Quality Propagation](/data-flows/quality-propagation.md)
- [Sun Light Effects](/materials/sun-effects.md)
- [Sky Posterize](/materials/index.md)
- [Art Direction](/conventions/art-direction.md)
