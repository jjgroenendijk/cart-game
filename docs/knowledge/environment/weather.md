---
type: Subsystem
title: Weather
description: "Seeded weather: GPU particle fields, fading fronts, channel-driven mood."
tags: [environment, weather, particles, gpu]
timestamp: 2026-07-14T00:00:00Z
---

# Schema

Seeded, deterministic weather driver. Biomes supply weather weights that
pick presets.

## Presets

| Preset    | GPU Field | Notes                |
| --------- | --------- | -------------------- |
| clear     | No        | Nothing built        |
| rain      | Yes       | Vertex-shader motion |
| snow      | Yes       | Vertex-shader motion |
| fog       | Yes       | Vertex-shader motion |
| sandstorm | Yes       | Vertex-shader motion |
| blizzard  | Yes       | Vertex-shader motion |
| heatHaze  | Yes       | Vertex-shader motion |
| aurora    | Yes       | Vertex-shader motion |
| storm     | Yes       | Triggers lightning   |
| warmRain  | Yes       | Vertex-shader motion |

## Director

`WeatherDirector` (weatherDirector.ts) builds a schedule:

- **auto**: Creates 10 AUTO_SEGMENTS (~12 min) of fading fronts.
- **fixed**: Holds one preset indefinitely.

`setLevel(k in [0,1])` scales particle field opacity. During automatic fronts,
the field rebuilds whenever the resolved preset changes (once per handover
frame). A fixed sim step rarely samples the exact level-0 boundary, so the
swap is not gated on a zero crossing; at a handover the level is already
near zero (the prior front's fade-out just completed), so the rebuild is
visually seamless.

## Channels

`weatherChannels.ts` maps level to sky/cloud/ground effects:

| Channel    | Effect                                  |
| ---------- | --------------------------------------- |
| dim        | Reduces sky intensity                   |
| windFactor | Scales cloud drift speed                |
| wetness    | Writes uWetness for terrain CelMaterial |

`weather.update` calls `patchFog` LAST, stacking on DynamicSky fog.

`storm` dims (0.7) + speeds wind (1.8); `sandstorm`/`blizzard` are gale-force
too (dim 0.85, windFactor 1.6/1.5) so clouds visibly race during a dust wall
or whiteout, matching their particle windFactor + the weather-wind audio bed.

## Storm

Storm preset triggers lightning flashes from `src/environment/lightning.ts`
(additive sun/ambient boosts). Clears on non-storm front.

## Audio (GameAudioDriver.updateWeather)

`rain`, `warmRain`, and `storm` drive the rain bed (`AudioManager.setRainLevel`)
at the live envelope level; `warmRain` reuses the rain bed rather than a
separate asset. `sandstorm`, `blizzard`, and `storm` drive the weather-wind
bed (`AudioManager.setWeatherWindLevel`, `rainVoice.ts` `WeatherWindVoice`) at
the live envelope level — distinct from the car-speed wind voice
(`driveWind`). All other presets are silent.

## weatherPresets.ts

`weatherPresets.ts` defines `PRESET_ORDER` — fixes the cumulative-walk order
so `selectWeatherPreset(weights, seed)` is deterministic regardless of object
key insertion order. `DEFAULT_WEATHER_WEIGHTS` are `clear=0.7, rain=0.15,
snow=0.15` — reproduces the pre-biome partition bit-for-bit. DO NOT reorder
`PRESET_ORDER` without updating `Weather.test.ts` parity. `storm` and
`warmRain` are appended (no `DEFAULT` key) so legacy walk is unchanged.

## GPU Particle Field

`Weather.ts` renders rain/snow/fog/etc as a GPU-driven `THREE.Points`
field on layer 0 with `depthWrite:false` (visible through the
sky-posterize mask, skips Sobel).

- **Motion**: vertex shader advances particle positions from `velocity`
  - `position` attributes (uploaded once; `update()` never re-uploads).
    A `uTime` accumulator drives all motion — no CPU per-particle loop.
- **`advancePosition()`**: pure helper (jsdom-tested) implementing
  stateless continuous-wrap math: XZ bidirectional mod wrap around
  `uFocusX`/`uFocusZ` (world-stationary), Y ceiling reset.
- **Point size**: `gl_PointSize = uSize * uSizeRange / -mvPos.z`,
  clamped 1..32 (perspective attenuation).
- **Fog**: raw `ShaderMaterial` with `fog:true` + manual
  `fogColor`/`fogNear`/`fogFar` uniforms (`smoothstep(fogNear,
fogFar, -vViewPos.z)` mix — celWater parity pattern).
- **Rain/snow parity**: velocity-init RNG draw order preserved so
  presets are deterministic per seed.
- **No frustum cull**: the wrap happens in the vertex shader around
  `uFocusX`/`uFocusZ`, so the CPU-side geometry bounds stay origin-centred;
  a travelled focus would let the stale sphere cull the whole field
  (rain/snow blink out looking away from spawn). The `Points` sets
  `frustumCulled = false` — the field always surrounds the camera.

## Persistence

`weatherStorage` persists mode under `gamecart.weather.v1`.

`weatherConfig` exports the `WeatherChoice` type for race-config weather
preview: `auto` plus every `WeatherPreset` (`WEATHER_MODE_VALUES`), so the
race-config WEATHER row can manually force any preset, not just the
biome-reachable ones. `WeatherMode` is defined in `weatherDirector.ts`.
`setWeatherMode` is a method on `Environment`, not `Weather` directly.

# Cross-References

- [Environment Cascade](/environment/cascade.md)
- [DynamicSky](/environment/dynamic-sky.md)
- [Biomes](/biomes/framework.md)
