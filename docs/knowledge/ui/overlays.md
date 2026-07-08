---
type: System
title: UI Overlays
description: "DOM-based overlay system: menus, in-race HUD, minimap, settings, performance stats."
tags: [ui, dom, overlays, hud]
timestamp: 2026-07-07T00:00:00Z
---

# Schema

All overlays use plain DOM/canvas with minimal typed inputs from Game.
UI classes own their DOM nodes and expose `remove()` for teardown.

**Style system**: `menuStyles.ts` (070 kit, 072 editorial reskin) is the single
source for neutral button visuals (primary/secondary/ghost), panel/selector-row
styles, the editorial layout primitives (kicker, serif heading, hairline,
telemetry, status dot, corner marks, vignette, grain), and `MENU_CSS`
hover/focus rules. The start menu's field-journal presentation lives in
`startMenuStyles.ts`. See [Menu Styles](/ui/menu-styles.md).

| Overlay             | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `StartMenu`         | Corner-anchored "field notes" layout over the live scene:           |
|                     | identity (kicker + serif masthead) top-left, a SEED block (SEED     |
|                     | kicker + TRACK CODE picker) top-right, drive-controls hint          |
|                     | bottom-right, and a bottom-left console (LAUNCH kicker, START RACE, |
|                     | MODE + BIOME rows, SETTINGS) as transparent sharp text controls     |
|                     | split by hairlines. Seed lives only top-right and mode/biome only   |
|                     | bottom-left (no duplicated readout). Framed by corner brackets +    |
|                     | vignette + grain. KartSelect and RaceConfig are separate overlays   |
|                     | shown in sequence by GameFlow.                                      |
| `PauseOverlay`      | Escape-pause overlay                                                |
| `SettingsOverlay`   | MASTER volume, MUSIC volume, SFX volume, MUTE, POSITIONAL AUDIO,    |
|                     | HRTF, BACK. (Graphics quality is in Renderer; time of day and       |
|                     | weather are in RaceConfigOverlay.)                                  |
| `RaceConfigOverlay` | MODE, TIME, SPEED, WEATHER with live sky/weather preview            |
| `KartSelectOverlay` | 6 KART_VARIANTS, stat bars (speed/accel/grip/mass), 2P sequential   |
|                     | picking                                                             |
| `Countdown`         | Pre-race countdown overlay                                          |
| `RaceHud`           | In-race HUD: speed gauge, position, lap counter                     |
| `Minimap`           | Canvas minimap rendering spline track                               |
| `LifeBar`           | Water life-drain bar (blue gradient when in water)                  |
| `HudAnchor`         | Per-player HUD anchor for 2P split-screen                           |
| `StatsHud`          | F3 performance overlay (reads `renderer.info`)                      |
| `resultsDisplay`    | Race results display                                                |
| `menuNav`           | Keyboard arrow + gamepad D-pad/stick navigation                     |

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

## SeedPicker (058; plain-seed entry 078)

`SeedPicker` (`src/ui/SeedPicker.ts`) renders one `CircuitId` as its canonical
`XXXX-XXXX-XX` short code inside the StartMenu top-right SEED block (below a
`SEED` kicker) — the sole seed control on the menu. Layout is a header row
(`TRACK CODE` label + COPY/RANDOM buttons) with a full-width text `<input>`
(`gc-code-input`) below it; the input is the keyboard focus unit.

The field is a smart single input (078): it accepts EITHER a valid short code
OR a plain numeric seed. `commit()` (Enter/blur/change) tries
`parsePlainSeed` first (decimal, or `0x`-prefixed hex, in the uint32 range),
then `parseCircuitCode`. Disambiguation is by shape — an all-digit or
`0x`-hex value is always a plain seed, never reaches the code parser (no
accidental-code collision); bare hex without `0x` is rejected. A plain seed
derives its biome via `selectBiome` (same seed -> same biome, deterministic),
matching RANDOM. Invalid input flashes a `gc-reject` cue (shake keyframe in
`startMenuStyles.ts` `LOCAL_CSS`) and reverts — no silent snap-back. After any
apply the field re-renders to the canonical code. COPY writes the code to
`navigator.clipboard` (no-op if unavailable); RANDOM draws a fresh uint32 seed
and derives the biome via `selectBiome`. The biome is NOT shown here — the
BIOME selector row is the single source of truth and is kept in sync via
`setCircuit` / `handleCircuitChange`.

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
// menuStyles.ts (072) — flat neutral button + an editorial primitive.
// buttonStyle returns cssText; styleMenuButton also tags gc-btn classes.
styleMenuButton(startBtn, "primary"); // near-white INK fill, dark ink, sharp
const kicker = kickerLabel(); // tracked uppercase muted label
const rule = hairlineRule(40); // 1px translucent divider
```

# Citations

- [Menu Styles](/ui/menu-styles.md)

- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
- [Renderer](/core/renderer.md)
