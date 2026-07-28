---
type: Concept
title: Tundra — Art & Vibe Guide
description: "The nordic register: cold mist, snow plains, low pale sun, hushed quiet."
tags: [biomes, art-direction, vibe, tundra, nordic]
timestamp: 2026-07-11T00:00:00Z
---

# Identity

The nordic register — Skyrim's tundra by way of The Witcher 3's Skellige,
painted. Cold mist, snowlines, low raking pale sun, dark pine against
white. This mood belongs to tundra ALONE: it is not a global default and
must not leak into other biomes. The most fully pinned register after
temperate; the [art-direction](/conventions/art-direction.md) register
table carries its anchors.

Vibe words: hushed, cold, sparse, ancient, dignified.

# Palette anchors

From `src/environment/biomes/tundra/biome.ts` and the art-direction nordic anchors:

| Slot        | Hex       | Reads as             |
| ----------- | --------- | -------------------- |
| road        | `#8a8a8a` | frozen gravel        |
| grass       | `#d8e0d8` | snow field           |
| sand        | `#c2b280` | exposed frozen earth |
| rock        | `#9aa0a8` | cold grey stone      |
| moss accent | `#6e7c4e` | tundra moss          |
| pine        | `#31503f` | dark nordic pine     |

Livery bias when dressed for this register: muted oxblood `#a8452f`,
steel `#41707f`, brass accent `#c9a86a`.

# Flora set

Sparse but tall (`src/environment/biomes/tundra/flora.ts`), per streamed
chunk (big-prop sum 7, cap 8):

- `pine` (3, big) — snow-capped `coniferTree`, per-seed trunk 8–11 m
  (~11–15 m total); the lone-north silhouette.
- `deadSpruce` (1, big) — dark `snagTree` (5–8 m), stark against drifts.
- `iceRock` (2, big) + `erratic` (1, big) — icy dodecas; the erratic is a
  pale 1.5–2.6 m glacial boulder dropped on the plain.
- Decor: `snowBush` 16, `frostTuft` 10 (pale grass through the crust).

# Light & sky

Overcast zenith `#5f6c7c` to khaki horizon `#c4beac`; mist fog `#b6c0c2`.
Biome bias in code: fog `#d8dde0`, sky `#b8c4cc`
(`src/environment/biomes/tundra/biome.ts`). Sun low and pale, never golden. Water freezes toward
`#b8d0d8`.

# Weather habits

The greyest sky table: clear only 0.5, snow 0.35, blizzard 0.15. Falling
snow is the biome's resting state, not an event.

# Track character

Steady snow-plain roads: wide-ish (5.5–9), gentle width breathing, flowing
sweeper laps over rolling drifts, rare forks. Serene, rhythmic driving —
the meditative biome.

# Music direction (future audio)

- Mood: sparse nordic quiet; wind is an instrument; silence carries weight.
- Tempo: slow (60–76 BPM feel), heartbeat-steady.
- Mode: dorian/aeolian, open fifths, no busy harmony.
- Timbre targets (procedural synthesis): low sustained string drone,
  distant horn swells, frame-drum heartbeat, airy voice-like pad high and
  far away; filtered noise as wind bed shared with the weather layer.
- Space: vast and muffled — long soft reverb, high-frequency rolloff like
  falling snow absorbing the world.

# Citations

- `src/environment/biomes/tundra/biome.ts` — definition
- `src/environment/biomes/tundra/flora.ts` — pine/spruce/erratic + ground decor builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md) — nordic anchors
- [Weather](/environment/weather.md) — snow/blizzard presets
