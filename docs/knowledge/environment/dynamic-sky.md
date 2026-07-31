---
type: Subsystem
title: DynamicSky
description: Day/night cycle rendering sun arc, moon, star field, and atmospheric fog
tags: [environment, sky, day-night]
timestamp: 2026-08-01T00:00:00Z
---

# Schema

Owns the day/night cycle: sun arc, star field (`THREE.Points`), moon disc
(`THREE.Mesh`), and atmospheric fog. DynamicSky's visible objects (stars,
moon) render on layer 0 (`SKY_LAYER = 0`). The gradient sky dome/mesh is
owned by the Renderer's SkyPosterizePass, not DynamicSky. That gradient is
view-direction (world elevation) based, driven by a per-view inverse
view-projection, so it stays fixed to the world as the camera moves.

Writes to dayCycleState singleton consumed by lightUniforms and weather fog.

`DayCycleState` includes `shadowFade` — an elevation-driven smoothstep
over 3-18 deg (`SHADOW_FADE_LOW=3`, `SHADOW_FADE_HIGH=18`), symmetric
at dawn/dusk. Renderer uses it to fade shadow-map contribution and gate
`castShadow`.

# API

`setElapsed`, `setDayLength`, `setFrozen` allow reconfiguration without
rebuild.

DynamicSky.update runs FIRST in the [environment cascade](/environment/cascade.md)
before biome bias, weather, and fog patching.

# Examples

```ts
sky.setElapsed(0.3); // jump to 30% of day
sky.setDayLength(120); // 120 real seconds per cycle
sky.setFrozen(true); // pause cycle for menu
```

# Runtime Sky Capture

The procedural sky dome (layer 2) is baked into a HalfFloat cube map at
runtime so CelMaterial can sample a sky-tinted directional ambient.
`SkyCapture` (`src/environment/SkyCapture.ts`) owns a
`WebGLCubeRenderTarget` (HalfFloat, mipmapped, `LinearMipmapLinearFilter`)

- a `CubeCamera` (scene-graph node) + 6 face cameras. Pure helpers
  (`shouldCaptureSky`, `nextCaptureFace`, `roughnessToMipLevel`,
  `cubeMipCount`, `SKY_CAPTURE_FACE_COUNT`) are jsdom-testable; the `SkyCapture`
  GL class needs a live WebGL2 context.

Layer-2-only invariant: every capture camera sets `.layers.set(2)` so the
cube never sees terrain (layer 1), props/karts (layer 0), water, or weather
particles -> zero feedback loop into the lit scene. The dome is centered at
origin and effectively infinite, so capture renders from (0,0,0).

Amortized cadence: one cube face per frame, driven by the day-cycle phase.
`shouldCaptureSky` returns true once `cycleT` has advanced >= 1/64 of a
cycle since the last full bake; a full refresh is then 6 frames (one per
face via `nextCaptureFace`). `invalidate()` forces a full re-bake from face
0 on the next frames (weather-preset change).

`Renderer.applyDayCycle` calls `skyCapture.update(state.cycleT)` after the
sky `sunPosition` write so the cube reflects the current sky, then publishes
`lightUniforms.uSkyEnv.value = skyCapture.texture`. CelMaterial samples it
under the `SKY_ENV` define (see [cel-material](/materials/cel-material.md)).

Tier gating via `skyEnvSize` (`src/core/quality.ts`): low 0 = capture off
(no RT, no cameras, `uSkyEnv` stays null -> flat ambient unchanged); med 64;
high 128. Zero committed media: the cube is filled each session from the
live sky shader, never loaded from disk.

# Cross-References

- [Environment Cascade](/environment/cascade.md)
- [Weather](/environment/weather.md)
- [CelMaterial](/materials/cel-material.md)
- [Light Uniforms](/materials/light-uniforms.md)
- `src/environment/SkyCapture.ts`
- `src/environment/Clouds.ts`
- `src/environment/SunDisc.ts`
