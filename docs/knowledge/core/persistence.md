---
type: System
title: Persistence
description: "Versioned localStorage for settings, kart selection, and time-of-day config."
tags: [core, persistence, storage, settings]
timestamp: 2026-07-07T00:00:00Z
---

# Persistence

Three independent versioned localStorage stores, each split the same way: a
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

## Settings

`src/core/settings.ts` owns the `SettingsState` shape (masterVolume,
musicVolume, sfxVolume, muted, positionalAudio, hrtf) and `validateSettings`,
which clamps volumes to [0,1], defaults the booleans, and always returns
exactly the six fields (no stray keys). `src/core/storage.ts` persists it under
the v1 schema; SettingsOverlay consumes both.

## Kart selection

`src/core/kartSelection.ts` defaults both players to "balanced" and
`validateSelection` normalizes any input into a 2-element `KartVariantId[]`
(unknown ids fall back to "balanced"; slots past 1 are ignored).
`src/core/kartSelectionStorage.ts` persists it under a distinct v1 key.

## Time of day

`src/core/timeOfDayConfig.ts` owns mode (`static` | `dynamic`), phase, and
dayLengthSeconds, plus the phase->cycleT map and speed presets.
`validateTimeOfDayConfig` clamps bad fields to defaults;
`timeOfDayToEnvParams` maps a config to the params Environment.setTimeOfDay
consumes. `src/core/timeOfDayStorage.ts` persists it under a distinct v1 key.

## Citations

- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
