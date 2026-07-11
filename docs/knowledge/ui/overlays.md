---
type: System
title: UI Overlays
description: "DOM-based overlay system: menus, in-race HUD, minimap, settings, performance stats."
tags: [ui, dom, overlays, hud]
timestamp: 2026-07-08T00:00:00Z
---

# Schema

All overlays use plain DOM/canvas with minimal typed inputs from Game.
UI classes own their DOM nodes and expose `remove()` for teardown.

**Style system**: `menuStyles.ts` is the single
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
| `KartSelectOverlay` | Two stages per player: 6 KART_VARIANTS (stat bars for               |
|                     | speed/accel/grip/mass), then 8 KART_COLORWAYS paint (two-tone       |
|                     | swatch), with a live 3D preview (`KartPreview`) between the name    |
|                     | and swatch. Back unwinds paint -> model -> prior player -> menu.    |
|                     | 2P picks sequentially; delivers `KartPick[]` (variant + colorway).  |
| `KartPreview`       | `createKartPreview` (`src/ui/KartPreview.ts`): small transparent    |
|                     | WebGL turntable rendering the exact racing mesh (shared             |
|                     | `buildKartVisual`) through its own RenderPass -> OutputPass         |
|                     | composer with fixed studio light uniforms (decoupled from the       |
|                     | day-cycle lightUniforms, which live in the main camera's view       |
|                     | space). Factory returns null without WebGL (jsdom) and the overlay  |
|                     | skips it. Model stage previews an unpersisted model in its stock    |
|                     | paint (mirrors confirm semantics); paint stage previews the live    |
|                     | paint cursor. Overlay owns the lifecycle: setStyle on cursor        |
|                     | change, start/stop with show/hide, dispose on remove. Game injects  |
|                     | the factory via GameFlow's `kartPreview` option.                    |
| `Countdown`         | Pre-race countdown overlay                                          |
| `RaceHud`           | In-race glance HUD (lap/position/timer) restyled as editorial       |
|                     | telemetry rows (kicker key + value) in the neutral menuStyles       |
|                     | tokens (INK/INK_MUTED/HAIRLINE). cssText set once at construction;  |
|                     | update() mutates only value textContent. Compact system sans, no    |
|                     | panel chrome, no grain/vignette (readability). Contracts (HudState, |
|                     | ctor anchors, update/applyLayout/show/hide/remove, formatTime)      |
|                     | unchanged.                                                          |
| `Minimap`           | Canvas minimap + static hairline frame; neutral INK-family track    |
|                     | + rival + MENU_ACCENT player blip (drops arcade white). Redraw path |
|                     | unchanged; frame is static DOM, not rebuilt per frame.              |
| `LifeBar`           | Neutral editorial life-drain bar (PANEL_INK track, INK fill,        |
|                     | HAIRLINE border); drops the blue gradient + glow. Biome-neutral.    |
|                     | Width conveys life; cssText set once; update mutates width only.    |
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

## SeedPicker

`SeedPicker` (`src/ui/SeedPicker.ts`) renders one `CircuitId` as its canonical
`XXXX-XXXX-XX` short code inside the StartMenu top-right SEED block (below a
`SEED` kicker) — the sole seed control on the menu. Layout is a header row
(`TRACK CODE` label + COPY/RANDOM buttons) with a full-width text `<input>`
(`gc-code-input`) below it; the input is the keyboard focus unit.

The field accepts any non-empty text as a seed (never rejects,
Minecraft-style). `commit()` (Enter/blur/change) order: a plain number
(`parsePlainSeed`: decimal, or `0x`-prefixed hex, in the uint32 range) is
always a seed — tried before codes so a pure-digit value never decodes as a
share code; otherwise a valid short code (`parseCircuitCode`) wins and keeps
its frozen biome; otherwise the string hashes to a uint32 seed via
`resolveSeed` (FNV-1a `hashSeed`, `src/core/rng.ts`). Every non-empty input
resolves to a world; there is no reject/shake cue. A derived/hashed seed
derives its biome via `selectBiome` (same seed -> same biome, deterministic),
matching RANDOM. Empty input is a no-op revert. After any apply the field
re-renders to the canonical code. COPY writes the code to `navigator.clipboard`
(no-op if unavailable); RANDOM draws a fresh uint32 seed and derives the biome
via `selectBiome`. The biome is NOT shown here — the BIOME selector row is the
single source of truth and is kept in sync via `setCircuit` /
`handleCircuitChange`. The seed drives the whole world (terrain relief +
dressing + clouds + wildlife + weather), not just the track (see
[../terrain/height-pipeline.md](../terrain/height-pipeline.md)).

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
// menuStyles.ts — flat neutral button + an editorial primitive.
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
