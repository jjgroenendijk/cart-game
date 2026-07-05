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

Game never constructs an overlay directly (046 seam). New overlays are added in
GameFlow.

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

## Citations

- [UI Overlays](/ui/overlays.md)
- [Game](/core/game.md)
- [PlayerView](/core/player-view.md)
