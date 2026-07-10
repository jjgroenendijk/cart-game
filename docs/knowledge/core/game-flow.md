---
type: System
title: GameFlow
description: "Screen state machine: overlays, pause/escape routing, countdown, persistence."
tags: [core, ui, state-machine]
timestamp: 2026-07-05T00:00:00Z
---

# GameFlow

Owns the GameState field and all overlays: StartMenu, PauseOverlay,
SettingsOverlay, RaceConfigOverlay, KartSelectOverlay, and Countdown. RaceHud
is created by FieldBuilder; resultsDisplay is created in Game's constructor.
Every on\* handler, Escape routing, and persistence lives here.

Game never constructs an overlay directly. New overlays are added in
GameFlow.

GameFlow reads `host.current` (a `CircuitId`) and translates biome ↔ CircuitId
at the boundary: `onBiomeChange` / `onStart` keep the current seed and swap only
the biome index, then call `host.rebuildWorld(id?)`. The `FlowHost` surface
exposes both `readonly current: CircuitId` and the derived `currentBiome`, plus
`rebuildWorld(id?: CircuitId)`.

The pure FSM lives in `src/core/gameState.ts`: it exports `transition(state,
event)`, the `GameState` type, and the `GameEvent` type. The module is
side-effect free (no DOM, no Game deps) and runs under jsdom. GameFlow
calls `transition()` on each user action.

## Schema

| State        | Overlay active    |
| ------------ | ----------------- |
| `menu`       | StartMenu         |
| `raceConfig` | RaceConfigOverlay |
| `select`     | KartSelectOverlay |
| `countdown`  | Countdown         |
| `racing`     | RaceHud           |
| `paused`     | PauseOverlay      |

Settings is a toggle via `settingsOrigin` (`"menu" | "pause" | null`), not a
state. Results visibility is a boolean flag `resultsShown` on Game, not a state.
The `GameState` type is `"menu" | "select" | "countdown" | "racing" | "paused" |
"raceConfig"`.

## Race-config weather pending

The RaceConfigOverlay previews weather live via `applyWeatherMode` while a
`pendingWeatherMode` records the user's pick. Confirm commits
`weatherMode = pendingWeatherMode`; Back reverts the live preview to
`weatherMode`. `onStart` resets `pendingWeatherMode` to the persisted
`weatherMode` when opening the config, so confirming without re-picking
weather cannot apply a stale pick left over from an aborted prior session.

## Citations

- [UI Overlays](/ui/overlays.md)
- [Game](/core/game.md)
- [PlayerView](/core/player-view.md)
