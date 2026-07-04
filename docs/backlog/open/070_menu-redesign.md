# 070 Start-menu redesign + menu UX cleanup

Status: open

## Context

The start menu (`src/ui/StartMenu.ts`, 006/008/012/025) grew by accretion:
title -> MODE toggle -> START -> SETTINGS -> biome button row -> controls.
Several UX problems:

- Focus order starts on the MODE toggle, not the primary action (START).
- The window-level Enter/Space handler always calls `confirm()`, so
  pressing Enter while SETTINGS (or MODE) is focused starts the race
  instead of activating the focused control.
- MODE is a toggle button whose label shows current state; a cycling
  selector row (as in RaceConfigOverlay) is the established pattern.
- Biome select is a wrapping row of one button per biome. With 5 biomes
  registered and ~20 more in `docs/backlog/concept/`, buttons do not scale;
  RaceConfig-style `< VALUE >` rows do.
- Primary/secondary button styles are copy-pasted (with drift) across
  StartMenu, PauseOverlay, RaceConfigOverlay, KartSelectOverlay,
  SettingsOverlay.

## Scope

- New `src/ui/menuStyles.ts`: shared button kinds (primary/secondary/
  ghost), panel + selector-row styles, shared hover/active/focus CSS.
  Pure string builders, jsdom-testable.
- StartMenu redesign: fancy CSS-only title (gradient shine + checkered
  ribbon), frosted panel, logical order START RACE -> MODE row -> BIOME
  row -> SETTINGS, controls hint as kbd chips. MODE + BIOME become
  cycling selector rows (chevron buttons + ArrowLeft/Right + gamepad
  horizontal). Enter/Space activates the focused control (SETTINGS opens
  settings); anywhere else still starts. Public API unchanged
  (`onStart(mode, biome)`, `onSettings`, `onBiomeChange`, show/hide/
  remove, selectedMode/selectedBiome).
- Adopt the kit in PauseOverlay, RaceConfigOverlay, KartSelectOverlay,
  SettingsOverlay so all menu buttons share one visual language. No
  behavior change in those overlays.

Not in scope: track select (020), menu preview camera changes, audio.

## Acceptance

- Enter on focused SETTINGS opens settings, never starts a race.
- First focused control is START RACE.
- Biome/mode cycle via row chevrons, ArrowLeft/Right, and gamepad
  horizontal; biome change still fires the live world-rebuild preview.
- All overlays render buttons from `menuStyles` (single source).
- `npm run verify` green; zero committed assets (CSS-only visuals).
