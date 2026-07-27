---
type: System
title: Sun Light Effects
description: Analytic sun halo, god rays, lens flare in the final pass; toggleable, no HDR bloom.
tags: [materials, rendering, post-processing, lighting]
timestamp: 2026-07-27T00:00:00Z
---

# Sun Light Effects

Cinematic sun effects for the "Painted Wilds" cel look: a soft painted sky
halo, terrain-cut god-ray shafts, and a procedural lens flare. All three are
ANALYTIC additive terms folded into the existing final `SkyPosterizePass`
fragment (post-tonemap sRGB) — no HDR bloom pass, no extra render target. The
retired 074 approach used `UnrealBloomPass` on the linear HDR buffer and
whited the cel colors out; this reimplementation avoids global bloom entirely
and keeps every effect masked, capped, and independently switchable.

Each effect sits behind its own gain uniform that defaults to 0, so the
neutral path is byte-identical to the pre-159 frame. A Settings toggle drives
the gain to 0 to disable an effect; the quality tier scales its strength; and
the shared day-phase weight fades all three to nothing at night.

## Pure math (`src/materials/sunGlow.ts`)

WebGL-free helpers the Renderer calls per frame (jsdom-tested in
`sunGlow.test.ts`):

- `projectSunUv(sunDir, camera) -> {u, v, front}`: projects the world sun
  direction (a point at infinity) to a screen uv. `front` is a smooth [0,1]
  weight from the cosine of the angle between camera forward and sun direction:
  1 toward the view center, fading across the `FRONT_FADE` band (cos 0.2 ~=
  78deg) to 0 as the sun nears the ~90deg screen edge, and 0 once behind the
  camera. The smooth (not binary) crossover is deliberate — a binary gate popped
  the whole full-screen god-ray/halo wash on/off in a single frame as the camera
  turned, which read as a screen-wide FLICKER while driving. Every effect scales
  by this weight so it ramps out instead of snapping.
- `glowIntensity(elevDeg, sunIntensity, nightFactor) -> 0..1`: the shared
  day-phase weight. 0 at night and when the sun gives no light; strongest at
  LOW elevation (the dawn/dusk rake), never fully 0 at noon (0.45 floor).
- `effectGain(strength, enabled, glow)`: `enabled ? strength * glow : 0` — the
  final uniform gain per effect. Disabled -> exact identity path.

## Shader terms (`src/materials/skyPosterize.ts`)

The three effects are additive GLSL terms in the existing final fragment,
placed AFTER the day-phase grade and BEFORE the corner vignette (so the
vignette darkens the glow corners naturally). `setSunEffects(u, v, front,
aspect, color, halo, godray, flare)` writes the per-frame uniforms in one
call; `front` becomes `uSunFront`, the smooth [0,1] front-facing weight that
multiplies every effect term (halo, god rays, flare) so all three fade to 0
smoothly across the screen-edge crossover instead of popping.

- Sun halo: `exp(-r^2 / radius^2)` gaussian of the sun disc, multiplied by the
  sky mask (`step(1 - depthEps, depth)`) so a terrain silhouette hard-cuts the
  glow. Tint `uSunColor`, gain `uHaloIntensity`.
- God rays: a `GODRAY_SAMPLES`-step (32) screen-space march from the pixel
  toward the sun, accumulating the sky mask read from `tDepth` with per-sample
  `uGodrayDecay`. Terrain occludes shafts for free. Added over ALL pixels
  (shafts cross the scene) and scaled by `uSunFront` so the full-screen wash
  fades out smoothly as the sun turns behind the camera. Wrapped in `if
(uGodrayIntensity * uSunFront > 0.0)` so the disabled/behind path skips the
  loop entirely (free + identity).
- Lens flare: procedural ghosts (`lensGhost` discs at fractions along the
  sun->screen-center axis) plus a thin anamorphic streak. Depth-masked at the
  projected sun point (208): a 5-tap cross averaging sky-coverage (`sceneDepth`
  read at `uSunUv` and `uSunUv ± uFlareOccRadius`, divided by 5) yields a smooth
  `sunVis` 0..1 weight that multiplies the flare term, so the whole flare fades
  off as the sun dips behind a ridge instead of drawing ghosts over occluded
  terrain. Guarded like the god rays; free when the flare gain is 0.

Every gain defaults to 0, so with no Renderer wiring the pass output is
byte-identical to pre-159. Tunable knobs (`haloRadius`, `godrayDensity`,
`godrayDecay`, `godrayWeight`, `flareOccRadius`) are `SkyPosterizeOpts` fields.

## Settings + tiers

Each effect is user-switchable. `SettingsState.effects` (`src/core/settings.ts`)
carries three booleans — `sunHalo`, `godRays`, `lensFlare` — validated
field-by-field and persisted with the rest of the settings (no schema bump;
old stores default the block). Defaults: halo + god rays ON, lens flare OFF
(the flat cel look does not always want a camera artifact).

The quality tier sets the MAX strength per effect via `QualityKnobs`
(`sunHaloStrength`, `godRayStrength`, `lensFlareStrength`). They are kept
restrained (<= 0.5 on high) so effects read as soft painted light, never neon,
and are non-zero on every tier (low is subtler, not off) so a toggle always
does something. The final shader gain per effect is `effectGain(strength,
enabled, glow)` = `enabled ? strength * glowIntensity(...) : 0`.

## Citations

- [Sky Posterize](/materials/index.md)
- [Post Grade Math](/materials/post-grade.md)
- [Renderer](/core/renderer.md)
