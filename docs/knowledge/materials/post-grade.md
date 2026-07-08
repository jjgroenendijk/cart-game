---
type: System
title: Post Grade Math
description: Pure vignette + day-phase color-grade math mirrored into the final composer pass.
tags: [materials, rendering, post-processing]
timestamp: 2026-07-08T00:00:00Z
---

# Post Grade Math

Pure (no-WebGL, no-Three.js) finishing-grade math, now mirrored into the
final `SkyPosterizePass` fragment as neutral-by-default uniforms. Two ops:
a corner vignette and a day-phase color grade. Both run uniformly per pixel,
after the sky posterize block and before `gl_FragColor`, costing no extra
passes or render targets.

## Integration

`src/materials/skyPosterize.ts` exposes five uniforms on its fsQuad material
that mirror this math 1:1: `uVignetteStrength`, `uVignetteRadius`,
`uGradeSat`, `uGradeWarm`, `uGradeLift`. Neutral defaults make the path a
no-op: vignette strength 0 (factor 1 -> identity), grade sat/warm/lift 0.
The grade (luma mix, warmth r+/b-, lift add) then vignette run on ALL pixels
(sky and non-sky), after the sky-masked posterize branch — grade + vignette
are uniform per pixel, unlike the depth-masked sky replacement. A `Renderer`
per-slot write (064 commit 3) drives these from the day-cycle phase mix;
until then the pre-064 frame reproduces exactly.

## Vignette

`vignetteFactor(uvX, uvY, strength, radius)` returns an rgb multiplier
(1 = unchanged, <1 = darkened). Mirrors GLSL `length(vUv - vec2(0.5))`:

```ts
const d = Math.sqrt((uvX - 0.5) ** 2 + (uvY - 0.5) ** 2);
return 1 - strength * smoothstep(radius, CORNER_DIST, d);
```

`CORNER_DIST` = `Math.SQRT1_2` (distance center to corner). At center d=0 ->
factor 1; at a corner d=CORNER_DIST -> factor = `1 - strength`. Defaults:
`DEFAULT_VIGNETTE_STRENGTH = 0.12`, `DEFAULT_VIGNETTE_RADIUS = 0.35` (~12%
corner darkening, wide clear center).

## Day-phase grade

`gradeForCycleT(cycleT)` returns a `Grade { saturation, warmth, lift }`
interpolated across the four phase keyframes `[dawn, day, dusk, night]` via a
smoothstep segment blend that mirrors `src/environment/dayCycle.ts` `KEY_TS`
(same `[0, 0.25, 0.5, 0.75]` positions + wrap). All fields are deltas where
0 = no change:

- `GRADE_TABLE` day = identity. dawn/dusk: saturation +0.06, warmth +0.04.
  night: saturation -0.15, warmth -0.05, lift +0.01 (crushed blacks stay
  readable).

Saturation is a multiplier offset (mix toward luma), warmth shifts red up /
blue down, lift raises blacks. `gradeForCycleT` cross-fades exactly like the
dayCycle sky tints (same phase blend).

## Why pure

Exported as plain TS so unit tests assert the exact values the GLSL will
produce without spinning up WebGL, mirroring the `posterizeChannel` precedent
in `src/materials/skyPosterize.ts`. Tests live in
`src/materials/postGrade.test.ts`.

## Sibling: post-FX phase math

`src/materials/postFxPhase.ts` is a sibling pure module (same `KEY_TS`
keyframe segment blend, no THREE / no WebGL / no DOM, jsdom-tested). It owns
the day-phase-driven bloom + exposure targets and the godray weights the
lighting glow-up folds into the composer next:

- `bloomForCycleT(cycleT, tierScale)` -> `BloomParams { strength, radius,
threshold }`. threshold/strength ride per-phase tables
  (`[dawn, day, dusk, night]`); day sits high (threshold 2.1) so only true
  HDR emitters bloom, night drops to 0.7 so lights glow; strength is scaled
  by `bloomScale` (0/0.85/1 per tier). radius is phase-agnostic (0.35).
- `exposureForCycleT(cycleT)` -> scalar (`[0.97, 1.06, 0.97, 0.92]`); day
  brightest, night darkest.
- `godrayPhaseStrength(elevDeg)` -> crepuscular window weight
  (`smoothstep(-3,4,e) * (1 - smoothstep(18,45,e))`, clamped [0,1]); full
  4-18 deg above the horizon, zero at night/high noon.
- `godrayScreenFade(uvX, uvY, visible)` -> 0 off-screen, else fades as the
  sun nears a frame edge. Scaled by `godrayScale` (0/0.8/1 per tier).

The tier scalars `bloomScale` + `godrayScale` live on `QualityKnobs`
(`src/core/quality.ts`); the legacy `bloom` field stays until a later phase
refactors the Renderer off it. Tests live in
`src/materials/postFxPhase.test.ts`.

## Citations

- [Sky Posterize](/materials/index.md)
- [Renderer](/core/renderer.md)
