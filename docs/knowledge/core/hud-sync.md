---
type: Subsystem
title: HUD Sync
description: Pure per-frame HUD synchronisation helpers — lap, speed, position, timer, minimap.
tags: [core, ui, hud]
timestamp: 2026-07-05T00:00:00Z
---

# HUD Sync

Pure functions (no `this`, no Game state dependency) called by `Game.frame`
each frame to synchronise HUD/widget/map state with the live game model.
Extracted byte-for-byte from Game to keep Game under the 600-line cap.

## Functions

| Function              | Responsibility                               |
| --------------------- | -------------------------------------------- |
| `updateHudVisibility` | Shows speed-HUD DOM only while racing        |
| `updateSpeedHuds`     | Speed km/h via `clamp` × 3.6 per view        |
| `updateLifeBars`      | `controller.life` + `inWater` per view       |
| `updateRaceUi`        | RaceHUD lap/position/timer, minimap, results |

Each function loops over `views` (human players), reads typed deps, and
writes into DOM-backed HUD objects.

## Race UI Sync (`updateRaceUi`)

Single entry point for per-frame race overlay + minimap + result screen.
Takes a flat `RaceUiDeps` bundle:

```ts
interface RaceUiDeps {
  views: readonly PlayerView[];
  rivals: readonly Kart[];
  raceHuds: readonly RaceHud[];
  race: RaceManager;
  minimap: Minimap;
  resultsEl: HTMLElement;
  resultsShown: boolean;
}
```

Flow:

1. Snaps `race.snapshot()` to get per-player progress, positions, timer.
2. Constructs `HudState` (lap, targetLaps, position, totalKarts, timer) for
   each RaceHud instance.
3. Builds `MinimapKart[]` from human views (player=true) + rivals
   (player=false), passes to `minimap.update()`.
4. When `snap.phase === "finished"` and results not yet shown, populates
   `resultsEl` via `resultsText()` and returns `true`.

## Output Format

- **Speed**: integer km/h, `0..999` clamped.
- **Life**: raw `controller.life` + `controller.inWater` flag.
- **Race HUD**: `HudState { lap, targetLaps, position, totalKarts, timer }`
  → one `raceHuds[i].update(hudState)` per view.
- **Minimap**: `MinimapKart { x, z, player: boolean }[]` → minimap blips.
- **Results**: plain text via `resultsText(snap, views)`.

## Citations

- [PlayerView](/core/player-view.md)
