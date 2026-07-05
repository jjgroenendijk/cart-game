---
type: System
title: UI Overlays
description: "DOM-based overlay system: menus, in-race HUD, minimap, settings, performance stats."
tags: [ui, dom, overlays, hud]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

All overlays use plain DOM/canvas with minimal typed inputs from Game.
UI classes own their DOM nodes and expose `remove()` for teardown.

**Style system**: `menuStyles.ts` (070) is the single source for button
visuals (primary/secondary/ghost), panel/selector-row styles, and
`MENU_CSS` hover/focus rules.

| Overlay             | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `StartMenu`         | Main menu: Start, 2 Players, Settings, Kart Select, Race Config |
| `PauseOverlay`      | Escape-pause overlay                                            |
| `SettingsOverlay`   | Graphics quality, time of day, weather settings                 |
| `RaceConfigOverlay` | Biome, weather, AI count configuration                          |
| `KartSelectOverlay` | Kart variant picker                                             |
| `Countdown`         | Pre-race countdown overlay                                      |
| `RaceHud`           | In-race HUD: speed gauge, position, lap counter                 |
| `Minimap`           | Canvas minimap rendering spline track                           |
| `LifeBar`           | Water life-drain bar                                            |
| `StatsHud`          | F3 performance overlay (reads `renderer.info`)                  |
| `resultsDisplay`    | Race results display                                            |
| `menuNav`           | Keyboard arrow + gamepad D-pad/stick navigation                 |

**Lifecycle pattern:**

```ts
class ExampleOverlay {
  readonly element: HTMLElement;
  constructor(private game: Game) {
    this.element = document.createElement("div");
    // build DOM
  }
  remove(): void {
    this.element.remove();
  }
  update(): void {
    /* typed reads from game state */
  }
}
```

# Examples

```ts
// menuStyles.ts (070) — button style example
MENU_CSS = {
  primary: `background: var(--c-accent); color: var(--c-bg); ...`,
  secondary: `background: transparent; border: 2px solid var(--c-accent); ...`,
  ghost: `background: transparent; opacity: 0.5; ...`,
};
```

# Citations

- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
- [Renderer](/core/renderer.md)
