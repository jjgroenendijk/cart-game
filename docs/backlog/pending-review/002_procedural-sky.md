# 002 Procedural sky + lighting pass

Status: completed (pending review)
Commit: `7865277 feat(sky): procedural Preetham sky dome + synced sun lighting`

## Context
Sky was flat solid color `0x9fd3e8` (`Renderer.ts:21`); fog matched. No skybox,
no atmosphere. Cel objects now banded (001) — need a sky to match quality.

## Change
- `src/core/Renderer.ts`: import `Sky` from `three/addons/objects/Sky.js`.
- Single `sunDirection` (elevation 28deg, azimuth 135deg) drives Sky
  `sunPosition` AND directional light position + `setShadowTarget` offset
  (was hardcoded `+60,+90,+40` at `Renderer.ts:44`) -> now along sunDirection.
- Sky uniforms: turbidity 8, rayleigh 1.6, mieCoefficient 0.005, mieDirectionalG 0.8.
- Removed `scene.background = Color`; fog retinted to horizon `0xbcd6ea` (90..360).
- Hemisphere light retinted comic palette (sky 0x9fd0ff / ground 0x6a7a4a, i 1.0).

## Non-goals
- No `scene.environment`/PMREM — `MeshToonMaterial` doesn't use it meaningfully.
- No sky posterization (keep physical Sky smooth = BOTW-style contrast).

## Acceptance
- [x] Sky dome + synced sun/shadow direction (code-correct; typecheck clean)
- [x] No flat-color background artifact (background removed)
- [x] typecheck clean; scene renders (loaded, no console errors)
- [ ] OWED: visual confirm of sun-disc + gradient appearance (browser closed
      mid-verify; in-page script errored on a `THREE` global reference — my bug,
      not the game's). Code is standard three.js Sky usage.

## Depends on
001 (toon materials).
