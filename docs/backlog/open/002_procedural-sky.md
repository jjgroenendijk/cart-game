# 002 Procedural sky + lighting pass

Status: open (in progress)

## Context
Sky is flat solid color `0x9fd3e8` (`Renderer.ts:21`); fog matches. No skybox,
no atmosphere. Cel objects now banded (001) — need a sky to match quality.

## Goal
Replace flat bg w/ three `Sky` shader object (Preetham atmosphere). Sync visible
sun direction w/ directional light + shadow dir so shadows agree w/ sun disc.
Tune fog + hemisphere light to comic palette.

## Scope
- `src/core/Renderer.ts` only.
- Import `Sky` from `three/addons/objects/Sky.js`.
- Sky uniforms: turbidity, rayleigh, mieCoefficient, mieDirectionalG, sunPosition.
- Single `sunDirection` (from elevation/azimuth) drives Sky `sunPosition` AND the
  directional light position + `setShadowTarget` offset (currently hardcoded
  `+60,+90,+40` at `Renderer.ts:44`) -> derive from sunDirection.
- Remove `scene.background = Color`; keep `Fog`, retint to horizon.
- Bump hemisphere light saturation (sky cyan / ground warm green).

## Non-goals
- No `scene.environment`/PMREM — `MeshToonMaterial` doesn't use it meaningfully.
- No sky posterization (keep physical Sky smooth = BOTW-style contrast).

## Acceptance
- [ ] Sky dome renders; visible sun + matching shadow direction
- [ ] No flat-color background artifact
- [ ] typecheck clean; scene renders

## Depends on
001 (toon materials).
