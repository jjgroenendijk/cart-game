---
type: System
title: GameFlow
description: Screen state machine: overlays, pause/escape routing, countdown, persistence.
tags: [core, ui, state-machine]
timestamp: 2026-07-05T00:00:00Z
---

# GameFlow

Owns the GameState field and all overlays: StartMenu, PauseOverlay,
SettingsOverlay, RaceConfigOverlay, KartSelectOverlay, Countdown, RaceHud, and
resultsDisplay. Every on\* handler, Escape routing, and persistence lives here.

Game never constructs an overlay directly (046 seam). New overlays are added in
GameFlow.

## Schema

| State constant | Overlay active    |
| -------------- | ----------------- |
| `startMenu`    | StartMenu         |
| `raceConfig`   | RaceConfigOverlay |
| `kartSelect`   | KartSelectOverlay |
| `countdown`    | Countdown         |
| `racing`       | RaceHud           |
| `paused`       | PauseOverlay      |
| `settings`     | SettingsOverlay   |
| `results`      | resultsDisplay    |

## Citations

- [UI Overlays](/ui/overlays.md)
- [Game](/core/game.md)
- [PlayerView](/core/player-view.md)
