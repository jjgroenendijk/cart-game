---
type: System
title: FieldBuilder
description: "Per-field composition + lifecycle: one human view, rivals, race, VFX, AI fixed step."
tags: [core, lifecycle, field, ai, race]
timestamp: 2026-07-30T22:30:45Z
---

# FieldBuilder

`src/core/FieldBuilder.ts` owns the per-field state and the fixed-step that
drives it: the single human `PlayerView`, AI rival karts, the `RaceManager`,
the single `RaceHud`, kart action VFX, skid marks, track dressing, and the AI
tunings/RNG/stuck timers. Built once in Game's constructor and rebuilt in
place via `build()`/`dispose()` when the kart selection changes.

Game keeps the stable singletons (renderer, physics, terrain, audio,
minimap, results) and passes them in as `FieldBuilderDeps`; Game never
reaches into field internals. Net-zero relocation of the old in-Game methods:
Game delegates. Mirrors `GameAudioDriver` in holding plain data plus calls
into injected collaborators.

## Composition

The single human occupies grid index 0; AI rivals fill indices 1..N up to
`TARGET_FIELD` (6 total: 1 human + 5 rivals). `build()` computes the start
grid, constructs the kart, chase camera, speed readout, life bar, RaceHud,
the VFX/skid layers, and the dressing; primes the physics broadphase
(`physics.step()`) so every kart's first suspension raycast hits; and hides
the results overlay.

Finish is leader-only (the leader completing target laps finishes once).
Route plans pin one deterministic branch decision per (rival, branch), seeded
so a given world always forks the same way; personality shapes the odds.

Per-rival AI buffers (`aheadBuf`, `rivalsBuf`, route plans, stuck timers,
tunings/RNG) live in `src/core/fieldAi.ts` as a single `RivalAi` struct
built by `buildRivalAi` (split from FieldBuilder for the file cap; behavior
unchanged). Per-frame audio buffers (`audioHumanBuf`, `audioRivalBuf`,
listener slots) stay pooled in `build()` so `stepWorld` allocates zero
objects.

## Lifecycle

`build(humanPicks?)` constructs the field; `dispose()` tears down karts (rigid
bodies removed from the physics world, meshes removed from the scene), HUDs,
VFX, skids, and dressing, then zeroes every buffer array. A rebuild is
`dispose()` + `build()` with the same deps; Game calls `rebuildField(picks)`
when the kart selection changes. `setQuality(tier)` replaces the shared
near-terrain material when its detail tier changes and resizes the VFX/skid
layers in place, without a full field or terrain-geometry rebuild.

## Fixed step

`stepWorld(step, driving, inputs, time, state)` is one physics sub-step: it
advances human karts (driving gated by per-kart finished flag), advances
rivals via `produceInput` (corridor + graph-local horizon + rubber-band speed
scale + avoidance), updates race progress, zeroes horizontal velocity during
`countdown`, steps physics, then flushes audio. Respawn-on-zero-life and AI
stuck-detection (`tickStuck`/`sampleAhead`/`rivalPositions` in `fieldAi.ts`,
operating on the `RivalAi` struct) run here.

## Schema

| Field     | Description                               |
| --------- | ----------------------------------------- |
| `view`    | `PlayerView` (single human, grid index 0) |
| `rivals`  | AI `Kart[]`                               |
| `race`    | `RaceManager`                             |
| `raceHud` | `RaceHud` (single human)                  |

## Citations

- [Game](/core/game.md)
- [PlayerView](/core/player-view.md)
- [RaceManager](/race/race-manager.md)

## Source Links

- `src/core/FieldBuilder.ts` — field composition, lifecycle, fixed step
- `src/core/fieldAi.ts` — `RivalAi` struct + `buildRivalAi`/`tickStuck`/
  `sampleAhead`/`rivalPositions` (rival-AI state, split from FieldBuilder)
- `src/core/fieldAudioStates.ts` — pooled human/rival audio-state fills
