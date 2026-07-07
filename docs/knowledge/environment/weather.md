---
type: Subsystem
title: Weather
description: "Seeded weather: GPU particle fields, fading fronts, channel-driven mood."
tags: [environment, weather, particles, gpu]
timestamp: 2026-07-05T00:00:00Z
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

## Storm

Storm preset triggers lightning flashes from `src/environment/lightning.ts`
(additive sun/ambient boosts). Clears on non-storm front.

## weatherPresets.ts

`weatherPresets.ts` defines `PRESET_ORDER` — fixes the cumulative-walk order
so `selectWeatherPreset(weights, seed)` is deterministic regardless of object
key insertion order. `DEFAULT_WEATHER_WEIGHTS` are `clear=0.7, rain=0.15,
snow=0.15` — reproduces the pre-biome partition bit-for-bit. DO NOT reorder
`PRESET_ORDER` without updating `Weather.test.ts` parity. `storm` and
`warmRain` are appended (no `DEFAULT` key) so legacy walk is unchanged.

## Persistence

`weatherStorage` persists mode under `gamecart.weather.v1`.

`weatherConfig` exports the `WeatherChoice` type for race-config weather
preview. `WeatherMode` is defined in `weatherDirector.ts`. `setWeatherMode`
is a method on `Environment`, not `Weather` directly.

# Cross-References

- [Environment Cascade](/environment/cascade.md)
- [DynamicSky](/environment/dynamic-sky.md)
- [Biomes](/terrain/biomes.md)
