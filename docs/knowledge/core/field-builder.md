---
type: System
title: FieldBuilder
description: "Per-field composition + lifecycle: humans, rivals, race, VFX, AI fixed step."
tags: [core, lifecycle, field, ai, race]
timestamp: 2026-07-07T00:00:00Z
---

# FieldBuilder

`src/core/FieldBuilder.ts` owns the per-field state and the fixed-step that
drives it: human `PlayerView`s, AI rival karts, the `RaceManager`, per-view
`RaceHud`s, kart action VFX, skid marks, track dressing, and the AI
tunings/RNG/stuck timers. Built once in Game's constructor and rebuilt in
place via `build()`/`dispose()` when the player count (1P/2P) changes.

Game keeps the stable singletons (renderer, physics, terrain, audio,
minimap, results) and passes them in as `FieldBuilderDeps`; Game never
reaches into field internals. Net-zero relocation of the old in-Game methods:
Game delegates. Mirrors `GameAudioDriver` in holding plain data plus calls
into injected collaborators.

## Composition

Slots `0..humanCount-1` are humans; the rest are AI rivals up to
`TARGET_FIELD` (6 total). `build()` computes the start grid, constructs
karts, chase cameras, speed readouts, life bars, RaceHuds, the VFX/skid
layers, and the dressing; primes the physics broadphase (`physics.step()`)
so every kart's first suspension raycast hits; and hides the results overlay.

Finish mode is mode-dependent: 1P uses `leader`, 2P uses `allHumans`. Route
plans pin one deterministic branch decision per (rival, branch), seeded so a
given world always forks the same way; personality shapes the odds.

Per-rival buffers (`aiAheadBuf`, `aiRivalsBuf`) and per-frame audio buffers
(`audioHumanBuf`, `audioRivalBuf`, listener slots) are pooled in `build()` so
`stepWorld` allocates zero objects.

## Lifecycle

`build(humanCount, humanVariants?)` constructs the field; `dispose()` tears
down karts (rigid bodies removed from the physics world, meshes removed from
the scene), HUDs, VFX, skids, and dressing, then zeroes every buffer array.
A rebuild is `dispose()` + `build()` with the same deps; Game calls it when
the mode changes. `setQuality(tier)` replaces the shared near-terrain material
when its detail tier changes and resizes the VFX/skid layers in place, without
a full field or terrain-geometry rebuild.

## Fixed step

`stepWorld(step, driving, inputs, time, state)` is one physics sub-step: it
advances human karts (driving gated by per-kart finished flag), advances
rivals via `produceInput` (corridor + graph-local horizon + rubber-band speed
scale + avoidance), updates race progress, zeroes horizontal velocity during
`countdown`, steps physics, then flushes audio. Respawn-on-zero-life and AI
stuck-detection live here.

## Schema

| Field        | Description                            |
| ------------ | -------------------------------------- |
| `views`      | `PlayerView[]` (humans, index 0 first) |
| `rivals`     | AI `Kart[]`                            |
| `race`       | `RaceManager`                          |
| `raceHuds`   | `RaceHud[]` per human                  |
| `humanCount` | live player count                      |

## Citations

- [Game](/core/game.md)
- [PlayerView](/core/player-view.md)
- [RaceManager](/race/race-manager.md)
