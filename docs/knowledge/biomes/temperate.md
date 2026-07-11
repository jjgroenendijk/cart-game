---
type: Concept
title: Temperate — Art & Vibe Guide
description: "Warm storybook baseline: mossy meadows, soft morning light, pastoral calm."
tags: [biomes, art-direction, vibe, temperate]
timestamp: 2026-07-11T00:00:00Z
---

# Identity

The warm painted baseline of Painted Wilds — a storybook meadow on a mild
morning. Breath of the Wild field, Ghibli background painting. This is the
register the whole pipeline is tuned against: the default warm mood belongs
to THIS biome, not to the game globally; every other biome pins its own.

Vibe words: gentle, pastoral, unhurried, green, home.

# Palette anchors

Terrain is `DEFAULT_TERRAIN_CONFIG` verbatim (`src/terrain/heightmap.ts`);
the biome def (`src/environment/biomes/temperate/biome.ts`) carries zero overrides — the
parity biome.

| Slot  | Hex       | Reads as              |
| ----- | --------- | --------------------- |
| road  | `#6e6256` | warm packed earth     |
| grass | `#6aa84f` | fresh spring green    |
| sand  | `#c2b280` | dry path edges        |
| rock  | `#7d8a96` | grey-blue field stone |

Flora pigment: foliage `#4f7a3a`–`#6aa84f`, trunk `#6b4f2e`, petal pops
(yellow/orange/rose/violet/white) as the only saturation accents
(`src/environment/biomes/temperate/flora.ts`).

# Light & sky

No `skyFogBias` — the shared day-cycle tables run untinted: deep-blue
zenith to pale-cream horizon, warm low sun at the day edges. Outline color
sepia `#3a2f28` (see the register table in
[art-direction](/conventions/art-direction.md)).

# Weather habits

Mostly clear (0.7), soft rain and light snow in equal small measure —
weather is seasoning, never drama.

# Track character

Default `TrackTraits`: balanced width, moderate flow. The neutral kart
country lane other biomes deviate from.

# Music direction (future audio)

The vibe guide doubles as the music register for per-biome audio.

- Mood: warm, strolling, contented; the tune you hum while driving nowhere.
- Tempo: mid (roughly 96–108 BPM feel), relaxed swing.
- Mode: major, simple I–IV–V shapes; nothing chromatic.
- Timbre targets (procedural synthesis): plucked string (guitar/ukulele
  register), round flute/whistle lead, soft brushed noise percussion,
  occasional birdsong-like ornament high in the mix.
- Space: dry-ish, close, small-field intimacy — minimal reverb.

# Citations

- `src/environment/biomes/temperate/biome.ts` — definition (parity baseline)
- `src/environment/biomes/temperate/flora.ts` — tree/rock/bush/flower/grass builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Biome Framework](/biomes/framework.md)
