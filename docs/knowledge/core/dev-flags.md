---
type: Subsystem
title: Dev URL Flags
description: Query-param overrides to boot a deterministic frame without menu clicks.
tags: [core, debug, agent-tooling]
timestamp: 2026-07-17T08:00:00Z
---

# Dev URL Flags

Query-string overrides that jump the game straight to a deterministic state for
fast iteration and headless verification, skipping the menu/config/select
overlays. Parsed by the pure `parseDevFlags` in `src/core/devFlags.ts`.

## Gating

`main.ts` parses `window.location.search` on boot but only forwards the flags
into `Game` when the build is a dev build (`import.meta.env.DEV`) or the
`?debug` flag is present. Production boots ignore every flag, so a shared/public
URL cannot alter the game. Vite client types come from `src/vite-env.d.ts`.

## Flags

- `biome` — one of the `BIOME_ORDER` ids (temperate/desert/alpine/tundra/
  tropical/autumn/badlands/beach/mediterranean).
- `seed` — base-10 integer world seed.
- `weather` — a `WeatherChoice` (auto/clear/rain/snow/storm).
- `time` — a `TimeOfDayPhase` (dawn/morning/noon/afternoon/dusk/night); forced
  as a STATIC phase so the frame is deterministic (day length preserved).
- `kart` — a `KartVariantId`; forces the single human player's chassis (grid
  index 0). With a 1-element input, `validateSelection` sets pick[0] to the
  kart and pick[1] reverts to the default balanced kart.
- `quality` — a `QualityTier` (low/med/high).
- `autostart` — skip the menus and drop straight into a running race.
- `debug` — enable dev-flag handling in a production build (see Gating).
- `garage`, `freefly` — booleans consumed by the garage viewer / free-fly
  camera (their own docs). The garage reads its own extra params directly from
  `location.search` (not via `parseDevFlags`): `variant`/`colorway`/`view`/
  `grid`, plus compare mode's `compare`/`split`/`views`/`length`/`width`/
  `height`/`govern`/`refgrid` (`split` swaps the diff overlay for a side-by-side
  model|reference layout; `refgrid` overrides the 2x2 reference layout). `view`
  and each `views` token is a preset (`front/side/top/rear/iso/reariso`) or an
  arbitrary `az<deg>el<deg>[o]` orbit — see `docs/knowledge/dev/garage.md` and
  `docs/knowledge/dev/garage-compare.md`.

All value flags are "no opinion unless valid": unknown/omitted/invalid values
resolve to undefined and the game keeps its normal persisted default. Enum
matching is case-insensitive. Booleans are presence-based (`?autostart=false`
is still true).

## Application (Game constructor)

`GameOptions.dev` carries the parsed `DevFlags`. `Game` applies them at the
matching construction phases (`src/core/Game.ts`):

- seed/biome override the loaded `CircuitId` before `buildWorld` (helper
  `devCircuitId`).
- kart overrides `builtPicks` (via `validateSelection`) before `buildField`.
- weather/time override the flow's persisted config before the boot apply
  (helper `applyDevFlowConfig`, mutating `GameFlow.weatherMode` /
  `timeOfDayConfig`).
- quality + autostart run in `applyDevRuntime` (`src/core/gameDev.ts`) after the
  field is built: quality calls `setQuality`, autostart calls `GameFlow.autostart`.

## Autostart

`GameFlow.autostart({ picks? })` reuses the real handler chain
(`onStart` → `onRaceConfigConfirm` → `onSelectConfirm` → `onCountdownDone`), the
same transitions `Game.test.ts` drives, so race start and HUD/minimap wiring
stay identical. The transient overlays are created and torn down synchronously.
It passes the current biome to `onStart` to avoid a redundant world rebuild.
Because it goes through the real handlers, it persists its config (weather/time/
kart) like a normal race start — a dev-flag boot's choices stick.

## Testing

`src/core/devFlags.test.ts` covers parsing (valid/invalid/empty/case). The Game
wiring is covered in `src/core/Game.devFlags.test.ts`: forced biome/seed, the
plain menu boot, and autostart reaching the `racing` state.
