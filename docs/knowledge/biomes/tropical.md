---
type: Concept
title: Tropical — Art & Vibe Guide
description: "Golden-hour palm shore: amber horizon, teal shallows, warm sand, dusk-lazy warmth."
tags: [biomes, art-direction, vibe, tropical]
timestamp: 2026-07-11T00:00:00Z
---

# Identity

A palm shore locked at golden hour — the day's last warm hour stretched
into a whole biome. Amber light rakes across bright sand; the water goes
teal in the shallows and ink-blue past the reef. The one biome allowed to
feel openly luxurious, still painted, never postcard-glossy.

Vibe words: golden, laid-back, syncopated, lush, dusk.

# Palette anchors

From `src/environment/biomes/tropical/biome.ts`:

| Slot          | Hex       | Reads as                |
| ------------- | --------- | ----------------------- |
| road          | `#9a8258` | packed shore track      |
| grass         | `#8fae5a` | sun-bleached palm grass |
| sand          | `#e8c896` | warm golden sand        |
| rock          | `#9a7a55` | warm sea-worn stone     |
| water surface | `#8fcfc0` | lagoon                  |
| water shallow | `#2db8b8` | bright teal             |
| water deep    | `#0a3a55` | ink blue                |

Flora carries the biome's only saturated blooms (hibiscus, tropicalFlower)
over palms, ferns, seaOats (`src/environment/biomes/tropical/flora.ts`).

# Light & sky

The strongest register in code: full `skyFogBias` split — horizon
`#ffc78a` (amber) vs zenith `#3a5aa8` (deepening evening blue), fog
`#ffb488`, warm sun `#ffd0a0` and ambient `#ffd9b0`, factor 0.28 (above
the 0.2 default). Everything leans toward the sun's side of the sky.
Outline sepia `#3a2f28`.

# Weather habits

Clear (0.7) with warmRain (0.2) — rain here is warm, backlit, and brief —
plus ordinary rain (0.1). No cold weather ever reaches this shore.

# Track character

Twisty jungle trails: narrow (4.5–8), restless width, technical/flowing
layouts under the canopy, frequent forks. Playful, not punishing.

# Music direction (future audio)

- Mood: dusk-lazy, warm, subtly celebratory; the after-race drink.
- Tempo: relaxed groove (84–96 BPM feel), laid-back behind the beat.
- Mode: major with 7th/9th color; call-and-response phrases.
- Timbre targets (procedural synthesis): mallet lead (steel-pan/marimba
  register), round warm bass, shaker/rim syncopation, soft chord pads on
  the offbeat; surf noise low in the mix as the shore layer.
- Space: open-air warm — short lush reverb, gentle stereo sway like water.

# Citations

- `src/environment/biomes/tropical/biome.ts` — definition
- `src/environment/biomes/tropical/flora.ts` — palm/jungleRock/shore decor builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Water](/environment/water.md) — shallow/deep tint plumbing
