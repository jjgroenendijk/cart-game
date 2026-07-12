---
type: Concept
title: Desert — Art & Vibe Guide
description: "Sun-hammered dune sea: bleached golds, dusty haze, heat shimmer, wide horizons."
tags: [biomes, art-direction, vibe, desert]
timestamp: 2026-07-12T00:00:00Z
---

# Identity

A sun-hammered dune sea at permanent mid-afternoon. Everything is bleached
toward gold; the sky itself goes dusty. Journey's sand fields painted in
the Painted Wilds register — vast, still, slightly hostile in its silence.
Water does not exist here (`waterLevel: -100`).

Vibe words: bleached, shimmering, vast, dry, patient.

# Palette anchors

From `src/environment/biomes/desert/biome.ts`:

| Slot  | Hex       | Reads as           |
| ----- | --------- | ------------------ |
| road  | `#b39b6e` | hardpan track      |
| grass | `#c2a14d` | scorched scrub mat |
| sand  | `#e3cf8e` | bright dune face   |
| rock  | `#b08d5a` | baked sandstone    |

Flora pigment stays desaturated olive/tan: cactus `#5b7d3a`, yucca
`#6a7a4a`, dry shrub `#8a6a3a` (`src/environment/biomes/desert/flora.ts`). No lush
green anywhere — green reads as survival, not abundance.

# Light & sky

`skyFogBias`: fog toward warm dust `#e8cf9a`; the ZENITH goes hazy
grey-blue `#8fb6c8` (drained, never crisp) while the HORIZON warms to the
same dust `#e8cf9a` as the fog. Fog and horizon must share a hue: the
fully-fogged terrain edge dissolves into the horizon band of the sky
gradient, so a cool horizon would turn the haze into a hard silhouette
line instead of atmosphere. Sun glare is white-hot; shadows stay warm (no
cool shadow shift). Outline sepia `#3a2f28`.

# Weather habits

Clear-dominant (0.85); rare sandstorm walls (0.1) are the biome's one
violent mood; trace heatHaze (0.05) keeps the air wobbling.

# Track character

Broad open desert highways: wide (6–10.5), calm width breathing, power
layouts over near-flat dunes, scenic branch loops. Speed is the desert's
gift; corners are landmarks, not obstacles.

# Music direction (future audio)

- Mood: sparse, hypnotic, heat-dazed; long silences are content.
- Tempo: slow (70–84 BPM feel), even, trance-like.
- Mode: minor-pentatonic / phrygian color, bent unison lines.
- Timbre targets (procedural synthesis): low drone bed, hand-drum pulse,
  plucked long-decay string with pitch bends (oud register), thin high
  sustained tone as the heat-shimmer layer.
- Space: huge and empty — long pre-delay reverb, wide stereo, dry ground.

# Citations

- `src/environment/biomes/desert/biome.ts` — definition
- `src/environment/biomes/desert/flora.ts` — cactus/sandRock/yucca/dryShrub builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Weather](/environment/weather.md) — sandstorm/heatHaze presets
