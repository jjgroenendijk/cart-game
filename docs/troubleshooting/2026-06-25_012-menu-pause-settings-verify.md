# 012 menu: pause + settings v1 — verify

Date: 2026-06-25. Branch `feat/012-pause-settings`. 8 atomic commits; gate
green on each (typecheck + eslint + markdownlint + vitest + secretlint).
585 -> 687 tests (+102); 57 test files.

## Scope verified

- Pure units: gameState pause/resume/quit transitions; settings validate +
  clamp; storage versioned load/save (corrupt/wrong-version -> DEFAULTS);
  menuNav digestGamepad edges/repeat/deadzone.
- Game wiring (jsdom): pause/resume/quit state + audio suspend/resume +
  overlay show/hide; Esc toggles racing<->paused and closes settings;
  paused frame renders views but steps NO physics; settings boot-apply to
  the 4 audio setters; live-apply validate->apply->save.
- AudioManager graph: sfxBus + musicBus feed master (default 1.0); all SFX
  -> sfxBus, music -> musicBus; setSfxVolume/setMusicVolume move only their
  bus; mute drives master to 0. Routing tests updated to the new node graph.

## Dev-server smoke (Chrome DevTools MCP, M1)

`npm run dev` -> http://localhost:5173/. Menu loads; no black screen; only
console message is the pre-existing Rapier "deprecated init params" warning
(no errors). Render loop active (renderer.info frame counter advances across
rAF ticks); real GL context (ANGLE Metal, Apple M1); scene populated.

New UI exercised at runtime:

- StartMenu shows the new SETTINGS button (class `gc-settings`).
- Click SETTINGS -> SettingsOverlay shows (display flex) with 3 range sliders
  (master/music/sfx) + 1 mute checkbox; StartMenu hidden (display none) via
  openSettingsFromMenu. Matches the jsdom wiring tests.

## Deferred to review

- Live gamepad: D-pad/stick traversal + A confirm + B back across all three
  screens (jsdom has no navigator.getGamepads; the rAF poll never starts
  there, so this needs a physical pad).
- Audible balance: moving the music vs sfx slider should move only its bus
  (1P + 2P); engine/drift/wind/impact/uiBeep all still audible.
- Quit-cycle leak: repeated pause -> Quit -> menu -> Start should keep Rapier
  body + Three geometry counts stable (no double-dispose).
- Pause during 2P: both viewports keep rendering the frozen chase view under
  the dim overlay.

## Deviations from the plan

- Game owns the settings state + overlay (boot load + apply in its ctor),
  not main.ts. src/AGENTS.md constrains main.ts to bootstrap-only; Game had
  headroom after the FieldBuilder refactor, so settings stays cohesive with
  the audio + overlays Game already owns.
- `Game.respawnAhead` is public (FieldBuilder refactor: Game.test.ts drives
  it via cast after stepWorld moved into FieldBuilder).
- jsdom in this Node combo exposes no `localStorage`; storage tests stub an
  in-memory shim. storage.ts stays defensive (`globalThis.localStorage?.`).
