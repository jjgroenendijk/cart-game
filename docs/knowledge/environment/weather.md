---
type: Subsystem
title: Weather
description: "Seeded weather: GPU particle fields, fading fronts, channel-driven mood."
tags: [environment, weather, particles, gpu]
timestamp: 2026-07-12T00:00:00Z
---

# Schema

Seeded, deterministic weather driver. Biomes supply weather weights that
pick presets.

## Presets

| Preset    | GPU Field | Notes                        |
| --------- | --------- | ---------------------------- |
| clear     | No        | Nothing built                |
| rain      | Yes       | Vertex-shader motion         |
| snow      | Yes       | Vertex-shader motion         |
| fog       | Yes       | Vertex-shader motion         |
| sandstorm | Yes       | Vertex-shader motion         |
| blizzard  | Yes       | Vertex-shader motion         |
| heatHaze  | Yes       | Vertex-shader motion         |
| aurora    | Yes       | Vertex-shader motion         |
| storm     | Yes       | Triggers lightning           |
| warmRain  | Yes       | Vertex-shader motion         |
| leafFall  | Yes       | Slow tumbling colored leaves |

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

| Channel    | Effect                                            |
| ---------- | ------------------------------------------------- |
| dim        | Reduces sky intensity                             |
| windFactor | Scales cloud drift speed                          |
| wetness    | Writes uWetness for terrain CelMaterial           |
| snowCover  | Snow-cover target (snow 0.85, blizzard 1, else 0) |

`weather.update` calls `patchFog` LAST, stacking on DynamicSky fog.

## Snow accumulation

`channelLevel` emits an INSTANTANEOUS `snowCover` target (0..1) that jumps as a
front fades in/out. `Environment` does NOT write it straight to the shared
`snowUniform.uSnowCover`; it eases a CPU accumulator (`snowCoverEased`) toward
the target each frame via `easeToward` (`src/environment/snowAccum.ts`), then
writes that eased scalar.

- `easeToward(cur, target, dt, buildRate, meltRate)` is pure + jsdom-safe:
  framerate-independent (`rate * dt` step), monotonic, clamped so it can never
  overshoot. dt <= 0 or cur == target -> cur unchanged.
- Asymmetric: build faster than melt (`SNOW_BUILD_RATE` 0.06/s ~= 17 s to full,
  `SNOW_MELT_RATE` 0.02/s ~= 50 s to bare) -> a fall settles quickly, a thaw
  lingers.
- `snowCoverEased` is the SINGLE source of truth: one `snowUniform.uSnowCover`
  write fans out by reference to every terrain chunk + prop + track that opted
  into `snowCover` (materials/snowCover.ts). A fade-out (target -> 0) melts the
  cover back to bare ground.

Props opt in: `propFactory.buildOnce` sets `snowCover:true` on the decor
shared-template material, and `PropField.spawnBigBucket` sets it on the merged
big-prop bucket material (the per-prop builder material is disposed, so the flag
MUST live on the rebuilt bucket material). Props are FLAT (no heightmap) -> the
SNOW_COVER path reads the interpolated `vWorldNormal`, whitening tree crowns +
rocks + ground props. `snowSparkle` stays default-on (no prop tier plumbing).

## Storm

Storm preset triggers lightning flashes from `src/environment/lightning.ts`
(additive sun/ambient boosts). Clears on non-storm front.

## weatherPresets.ts

`weatherPresets.ts` defines `PRESET_ORDER` — fixes the cumulative-walk order
so `selectWeatherPreset(weights, seed)` is deterministic regardless of object
key insertion order. `DEFAULT_WEATHER_WEIGHTS` are `clear=0.7, rain=0.15,
snow=0.15` — reproduces the pre-biome partition bit-for-bit. DO NOT reorder
`PRESET_ORDER` without updating `Weather.test.ts` parity. `storm`,
`warmRain`, and `leafFall` are appended (no `DEFAULT` key) so legacy walk is
unchanged. `leafFall` (Autumn Forest) is a `soft` field: warm amber leaves
(`0xc8752a`), slow drifting fall (`-1.5`), high `drift` (3) for lateral
tumble.

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
- **Soft flakes** (`cfg.soft`, true for snow/blizzard/fog): binds `uSoft`=1.
  Fragment fades each point sprite to a round fuzzy blob by a radial
  `gl_PointCoord` falloff; vertex adds a gentle horizontal sway
  (`uSoft * 0.6 * sin(uTime*1.3 + position.z)`) so flakes waft. The sway phase
  reuses the EXISTING `position.z` attribute -> no new RNG draw, so the
  parity-locked `buildField` draw order is untouched. `uSoft` 0 (rain + hard
  presets) leaves alpha = `uOpacity` and px unswayed -> byte-identical output.

## Persistence

`weatherStorage` persists mode under `gamecart.weather.v1`.

`weatherConfig` exports the `WeatherChoice` type for race-config weather
preview. `WeatherMode` is defined in `weatherDirector.ts`. `setWeatherMode`
is a method on `Environment`, not `Weather` directly.

# Cross-References

- [Environment Cascade](/environment/cascade.md)
- [DynamicSky](/environment/dynamic-sky.md)
- [Biomes](/biomes/framework.md)
