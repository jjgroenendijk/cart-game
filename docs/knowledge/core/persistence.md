---
type: System
title: Persistence
description: "Versioned localStorage for settings, kart, weather, time-of-day, circuit id."
tags: [core, persistence, storage, settings]
timestamp: 2026-07-07T00:00:00Z
---

# Persistence

Five independent versioned localStorage stores, each split the same way: a
pure model+validate module (no DOM, no localStorage, jsdom-safe) and a thin
storage module that owns I/O. Every localStorage access is wrapped in try/catch
so a missing, corrupt, or private-mode store never throws — loads fall back to
defaults, saves are no-ops. Each store uses a distinct key and a numeric schema
version; a version mismatch on load yields defaults.

## Stores

| Store       | Model                | Storage                   | Key                         |
| ----------- | -------------------- | ------------------------- | --------------------------- |
| Settings    | `settings.ts`        | `storage.ts`              | `gamecart.settings.v1`      |
| Kart select | `kartSelection.ts`   | `kartSelectionStorage.ts` | `gamecart.kartSelection.v1` |
| Time of day | `timeOfDayConfig.ts` | `timeOfDayStorage.ts`     | `gamecart.timeOfDay.v1`     |
| Weather     | `weatherConfig.ts`   | `weatherStorage.ts`       | `gamecart.weather.v1`       |
| Circuit id  | `circuitCode.ts`     | `circuitStorage.ts`       | `gamecart.circuit.v1`       |

## Settings

`src/core/settings.ts` owns the `SettingsState` shape (masterVolume,
musicVolume, sfxVolume, muted, positionalAudio, hrtf) and `validateSettings`,
which clamps volumes to [0,1], defaults the booleans, and always returns
exactly the six fields (no stray keys). `src/core/storage.ts` persists it under
the v1 schema; SettingsOverlay consumes both.

## Kart selection

`src/core/kartSelection.ts` defaults both players to the stock balanced kart
and `validateSelection` normalizes any input into a 2-element `KartPick[]`
(`{ variant, colorway }`). Unknown variants fall back to "balanced"; an
unknown colorway falls back to the picked variant's stock paint; bare v1
variant-id strings are upgraded to the stock colorway; slots past 1 are
ignored. `src/core/kartSelectionStorage.ts` persists it under a distinct key
as schema v2 and still reads v1 payloads through the same validator.

## Time of day

`src/core/timeOfDayConfig.ts` owns mode (`static` | `dynamic`), phase, and
dayLengthSeconds, plus the phase->cycleT map and speed presets.
`validateTimeOfDayConfig` clamps bad fields to defaults;
`timeOfDayToEnvParams` maps a config to the params Environment.setTimeOfDay
consumes. `src/core/timeOfDayStorage.ts` persists it under a distinct v1 key.

## Weather

`src/core/weatherConfig.ts` owns the `WeatherChoice` type
(`"auto" | "clear" | "rain" | "snow" | "storm"`) and
`validateWeatherMode`, which normalizes any input into a safe
`WeatherChoice` (non-string or unknown values fall back to `"auto"`,
never throws). `src/core/weatherStorage.ts` persists the mode under
`gamecart.weather.v1` with the same version+try/catch pattern. See also
[Weather](/environment/weather.md).

## Circuit id

`src/core/circuitStorage.ts` persists the current `CircuitId` (seed +
biome) under `gamecart.circuit.v1`. `loadCircuitId` returns
`DEFAULT_ID` on missing/corrupt; `saveCircuitId` never throws. See
[circuit-code](/terrain/circuit-code.md) for the codec.

## Citations

- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
