---
type: Concept
title: Alpine — Art & Vibe Guide
description: "Granite massifs, thin cold air: steel-blue sky, pines, cliffs, vertical drama."
tags: [biomes, art-direction, vibe, alpine]
timestamp: 2026-07-11T00:00:00Z
---

# Identity

High mountain country — towering granite massifs, pine stands, scree
slopes. Where tundra is flat and quiet, alpine is vertical and dramatic:
the biome of exposure, climb, and nerve. Early Witcher 3 Kaer Morhen
valley in the Painted Wilds register.

Vibe words: vertical, granite, thin air, exposed, heroic.

# Palette anchors

From `src/environment/biomes/alpine/biome.ts`:

| Slot  | Hex       | Reads as             |
| ----- | --------- | -------------------- |
| road  | `#6e6256` | worn mountain pass   |
| grass | `#4f7a3a` | dark valley pine mat |
| sand  | `#c2b280` | gravel wash          |
| rock  | `#8a8a92` | bare granite         |

Terrain shape is the identity: `noiseAmp: 32` + low freq = wide massifs,
low `rockSlope: 0.55` exposes granite early so cliffs read from the road.
Flora: alpinePine, screeRock, lichenBush (`src/environment/biomes/alpine/flora.ts`) —
darker, harder greens than temperate.

# Light & sky

`skyFogBias`: fog toward cold slate `#b8c4cc`, sky toward steel blue
`#4a6a8a`. Light is clear and hard — high-altitude clarity, not tundra's
milky mist. Water (mountain lakes) cools to `#aec4cc`. Outline sepia
`#3a2f28`.

# Weather habits

Clear (0.55) but snow-prone (0.35) with real blizzards (0.1) — the
mountain turns on you faster than any other biome.

# Track character

Narrow passes that pinch hard and climb hard: width 4–6.5 with strong
variation, technical hairpin layouts, `elevationScale: 1.7`, shortcut
branches that reward nerve. The white-knuckle biome.

# Music direction (future audio)

- Mood: soaring but cold; grandeur with an edge of danger.
- Tempo: steady driving pulse (100–116 BPM feel) for the climbs.
- Mode: minor with heroic major lifts at crests.
- Timbre targets (procedural synthesis): horn-register lead, low string
  ostinato, deep tom pulse, icy high shimmer on ridgelines; drop the
  percussion for a beat at summit reveals.
- Space: echoing valley — medium-long reverb, distinct left/right slap.

# Citations

- `src/environment/biomes/alpine/biome.ts` — definition
- `src/environment/biomes/alpine/flora.ts` — alpinePine/screeRock/lichenBush builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Track Traits](/terrain/track-traits.md)
