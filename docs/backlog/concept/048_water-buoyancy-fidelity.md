# 048 Water buoyancy fidelity

Status: open (concept - to be refined)

## Context

`KartController.applyBuoyancy` (src/kart/KartController.ts:223-259) drives
water from a single flat scalar `waterLevel`: one upward impulse at the
chassis centre + a horizontal `linvel` drag. That cannot tilt the kart (no
torque), and it ignores the animated wave surface the player SEES:
`CelWaterMaterial` waves are GLSL-only (src/environment/Water.ts:53, uTime),
so the visual + the physics disagree. Water itself has no Rapier collider
(Water.ts:22 docblock).

`src/kart/buoyancy.ts` is pure + jsdom-tested; `KartController` calls
`buoyancyForce` + `lifeDelta`. The 4-wheel suspension loop
(KartController.ts:186-195) is the natural place to also sample buoyancy
per wheel.

## Goal

Pitch/roll-accurate buoyancy + a CPU wave height the shader and sim share:

1. Extract the wave sum from `CelWaterMaterial` into a pure
   `waterSurfaceHeight(x, z, time)` helper; feed both the GLSL uniform build
   and the kart sim from it (mirror the `heightAt`/`normalAt` truth-source
   pattern in terrain/).
2. Sample wave height at the 4 wheel points; `applyImpulseAtPoint` per wheel
   -> natural rotational response instead of one centre impulse.
3. Optional: a Water sensor collider firing `INTERSECTION_EVENTS` on
   enter/exit for splash SFX + particle spawn (today `inWaterState` is
   polled `depth > 0`, no transition event).

## Needs refinement

- GLSL/JS parity: the visual + sim surfaces MUST match or the kart appears
  to float above/below the visible wave. A single shared pure fn is the
  guard.
- Buoyancy tuning: `floatStrength` (DEFAULT_BUOYANCY, buoyancy.ts:17) was
  calibrated for the single-point model; per-wheel sampling changes the
  total upward force (~4x) -> recalibrate.
- Life drain (`lifeDelta`, buoyancy.ts:39) stays on the submerged flag.
- Sensor coupling: needs 047 `drainIntersectionEvents` + a water collider
  shape that follows the wave (or a flat trigger plane acceptable for
  enter/exit).
- Determinism: `waterSurfaceHeight` must be a pure fn of (x,z,t); no per-call
  RNG.

## Depends on

047 (intersection events for the optional splash sensor). Overlaps 043
(flora-avoids-water also wants a CPU water query -> share the helper). 003
(water/valley), 010 (Weather wind may affect wave direction).
