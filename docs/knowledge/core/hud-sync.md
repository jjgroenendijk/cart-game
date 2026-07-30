---
type: Subsystem
title: HUD Sync
description: Pure per-frame HUD synchronisation helpers — lap, speed, position, timer, minimap.
tags: [core, ui, hud]
timestamp: 2026-07-30T22:30:45Z
---

# HUD Sync

Pure functions (no `this`, no Game state dependency) called by `Game.frame`
each frame to synchronise HUD/widget/map state with the live game model.
Extracted byte-for-byte from Game to keep Game under the 600-line cap.

## Functions

| Function              | Responsibility                               |
| --------------------- | -------------------------------------------- |
| `updateHudVisibility` | Shows speed-HUD DOM only while racing        |
| `updateSpeedHuds`     | Speed km/h via `clamp` × 3.6                 |
| `updateLifeBars`      | `controller.life` + `inWater`                |
| `updateRaceUi`        | RaceHUD lap/position/timer, minimap, results |

Each function takes the single `view`, reads typed deps, and writes into
DOM-backed HUD objects.

## Race UI Sync (`updateRaceUi`)

Single entry point for per-frame race overlay + minimap + result screen.
Takes a flat `RaceUiDeps` bundle:

```ts
interface RaceUiDeps {
  view: PlayerView;
  rivals: readonly Kart[];
  raceHud: RaceHud;
  race: RaceManager;
  minimap: Minimap;
  resultsEl: HTMLElement;
  resultsShown: boolean;
}
```

Flow:

1. Snaps `race.snapshot()` to get per-kart progress, positions, timer.
2. Constructs `HudState` (lap, targetLaps, position, totalKarts, timer) for
   the single RaceHud.
3. Builds `MinimapKart[]` from the player view (player=true) + rivals
   (player=false), passes to `minimap.update()`.
4. When `snap.phase === "finished"` and results not yet shown, populates
   `resultsEl` via `renderResults()` and returns `true`.

## Output Format

- **Speed**: integer km/h, `0..999` clamped.
- **Life**: raw `controller.life` + `controller.inWater` flag.
- **Race HUD**: `HudState { lap, targetLaps, position, totalKarts, timer }`
  → `raceHud.update(hudState)`.
- **Minimap**: `MinimapKart { x, z, player: boolean }[]` → minimap blips.
- **Results**: `renderResults(el, snap, view)` populates `resultsEl`.

## Citations

- [PlayerView](/core/player-view.md)
