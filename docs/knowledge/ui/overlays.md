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

| Overlay             | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `StartMenu`         | START RACE button, MODE selector (1P/2P), BIOME selector,         |
|                     | SETTINGS button. KartSelect and RaceConfig are separate overlays  |
|                     | shown in sequence by GameFlow.                                    |
| `PauseOverlay`      | Escape-pause overlay                                              |
| `SettingsOverlay`   | MASTER volume, MUSIC volume, SFX volume, MUTE, POSITIONAL AUDIO,  |
|                     | HRTF, BACK. (Graphics quality is in Renderer; time of day and     |
|                     | weather are in RaceConfigOverlay.)                                |
| `RaceConfigOverlay` | MODE, TIME, SPEED, WEATHER with live sky/weather preview          |
| `KartSelectOverlay` | 6 KART_VARIANTS, stat bars (speed/accel/grip/mass), 2P sequential |
|                     | picking                                                           |
| `Countdown`         | Pre-race countdown overlay                                        |
| `RaceHud`           | In-race HUD: speed gauge, position, lap counter                   |
| `Minimap`           | Canvas minimap rendering spline track                             |
| `LifeBar`           | Water life-drain bar (blue gradient when in water)                |
| `HudAnchor`         | Per-player HUD anchor for 2P split-screen                         |
| `StatsHud`          | F3 performance overlay (reads `renderer.info`)                    |
| `resultsDisplay`    | Race results display                                              |
| `menuNav`           | Keyboard arrow + gamepad D-pad/stick navigation                   |

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

## SeedPicker (058)

`SeedPicker` (`src/ui/SeedPicker.ts`) renders one `CircuitId` as its canonical
`XXXX-XXXX-XX` short code inside the StartMenu panel, between the BIOME row
and SETTINGS. A text `<input>` (`gc-code-input`) is the keyboard focus unit:
pasting a valid code + Enter/blur commits via `parseCircuitCode`; invalid
input reverts silently. COPY writes the code to `navigator.clipboard`
(no-op if unavailable); RANDOM draws a fresh uint32 seed and derives the
biome via `selectBiome`. A read-only span shows `biomeByIndex(id.biome).label`.

Edits flow through `StartMenu.handleCircuitChange` ->
`onCircuitChange` -> `GameFlow.onCircuitChange` -> `host.rebuildWorld(id)`,
which persists via `saveCircuitId` (see `circuitStorage.ts`). The biome row
mirrors back: `cycleBiome` calls `seedPicker.setCircuit` (no `onChange` —
avoids a feedback loop) before firing `onBiomeChange`.

StartMenu suppresses its global ArrowLeft/Right + Enter/Space while the input
is focused (`document.activeElement === seedPicker.inputElement` early-out) so
arrows edit text and Enter commits inside the picker. MenuNav reaches the
input between BIOME and SETTINGS (`startNav` elements list).

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
