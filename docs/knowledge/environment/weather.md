---
type: Subsystem
title: Weather
description: Seeded deterministic weather: GPU particle fields, fading fronts, channel-driven mood.
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

`setLevel(k in [0,1])` scales particle field opacity. Field rebuilds ONLY at
zero crossings (level reaches 0 or 1).

## Channels

`weatherChannels.ts` maps level to sky/cloud/ground effects:

| Channel    | Effect                                  |
| ---------- | --------------------------------------- |
| dim        | Reduces sky intensity                   |
| windFactor | Scales cloud drift speed                |
| wetness    | Writes uWetness for terrain CelMaterial |

`weather.update` calls `patchFog` LAST, stacking on DynamicSky fog.

## Storm

Storm preset triggers [lightning](WeatherLightning.ts) flashes (additive
sun/ambient boosts). Clears on non-storm front.

## Persistence

`weatherStorage` persists mode under `gamecart.weather.v1`.

`weatherConfig` maps race-config weather names to `WeatherMode` for preview.

# Cross-References

- [Environment Cascade](/environment/cascade.md)
- [DynamicSky](/environment/dynamic-sky.md)
- [Biomes](/terrain/biomes.md)
