---
type: System
title: Sun Light Effects
description: Analytic sun halo, god rays, lens flare in the final pass; toggleable, no HDR bloom.
tags: [materials, rendering, post-processing, lighting]
timestamp: 2026-07-10T00:00:00Z
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
  direction (a point at infinity) to a screen uv. `front` comes from the
  view-space z sign, resolved separately from the ndc perspective divide so a
  sun behind the camera reports `front = false` (no halo / flare drawn).
- `glowIntensity(elevDeg, sunIntensity, nightFactor) -> 0..1`: the shared
  day-phase weight. 0 at night and when the sun gives no light; strongest at
  LOW elevation (the dawn/dusk rake), never fully 0 at noon (0.45 floor).
- `effectGain(strength, enabled, glow)`: `enabled ? strength * glow : 0` — the
  final uniform gain per effect. Disabled -> exact identity path.

## Citations

- [Sky Posterize](/materials/index.md)
- [Post Grade Math](/materials/post-grade.md)
- [Renderer](/core/renderer.md)
