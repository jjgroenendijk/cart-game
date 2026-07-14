---
type: Concept
title: Autumn Forest — Art & Vibe Guide
description: "Enchanted autumn wood: golden/red canopy, soft light, drifting leaves, mossy floor."
tags: [biomes, art-direction, vibe, autumn]
timestamp: 2026-07-14T00:00:00Z
---

# Identity

A fairy-tale forest caught at the turn of the season — the woodland version of
golden hour, held for a whole biome. A dense canopy of turning leaves burns
orange, red, and gold overhead; soft mystical light filters through drifting
leaf-fall onto a mossy, mushroom-dotted floor. Enchanted and storybook, still
painted, never candy-bright.

Vibe words: golden, enchanted, hushed, mossy, storybook.

# Palette anchors

From `src/environment/biomes/autumn/biome.ts`:

| Slot          | Hex       | Reads as                |
| ------------- | --------- | ----------------------- |
| road          | `#7a5a3a` | warm packed-leaf track  |
| grass         | `#b07a3a` | amber/gold forest floor |
| sand          | `#a07a4a` | warm-brown soil         |
| rock          | `#6a6a3a` | mossy green-brown stone |
| water surface | `#7a8a76` | cool desaturated stream |
| water shallow | `#9aa06a` | amber-mossy shallows    |
| water deep    | `#2a3830` | deep cool pool          |

Flora carries the biome's fire: canopyTree + branchingTree crowns pick each
foliage lump from a 3-colour turning-leaf palette (orange `#d2691e`, red
`#b03a2a`, gold `#e0a83a`), so every tree — and every lump within a tree —
varies (`src/environment/biomes/autumn/flora.ts`).

# Flora set

Dense turning canopy over a busy forest floor, per streamed chunk (big-prop
sum 8, at cap 8):

- `autumnTree` (4, big) — `canopyTree` broadleaf, per-seed 5–7 m trunk under a
  full 3–5 lump crown; the multi-colour foliage palette mixes orange/red/gold
  across and within each crown.
- `autumnOak` (2, big) — `branchingTree` giant: 7–10 m trunk with visible limbs
  each carrying a foliage mass under a ~3.4 m crown; anchors the canopy depth.
- `mossRock` (2, big) — moss-greened noisy dodeca, radius-fn collider parity.
- Decor: `mushroom` 8 (bespoke toadstool clump — pale stems + red/brown domed
  caps), `fern` 12 (muted green fronds), `leafLitter` 24 (low fallen-leaf tufts
  over the moss).

# Light & sky

Full `skyFogBias` split for the enchanted mood — golden horizon `#e8c88a` over
a soft muted-blue zenith `#6a7aa8`, warm golden mist `#d8b884`, warm sun
`#ffdca8` + ambient `#f0d8b0`, factor 0.22 (just above the 0.2 default). Modest
factor keeps the cel bands reading — magical, not crushed. Outline sepia
`#3a2f28`.

# Weather habits

Calm and leaf-dominant: clear (0.45) with a heavy `leafFall` (0.4) — drifting
turning leaves as the signature weather — plus soft `fog` (0.15) for the misty
enchanted hush. No cold or violent weather reaches this wood.

# Track character

Winding forest trails: moderate width (5–8.5), a touch of width restlessness,
frequent forks, flowing + technical layouts weaving between the trees. Playful
and exploratory under the canopy.

# Music direction (future audio)

- Mood: enchanted, hushed, gently wistful; the storybook forest at dusk.
- Tempo: unhurried, breathing (72–88 BPM feel), rubato phrasing.
- Mode: major with lydian/modal colour; open suspended chords.
- Timbre targets (procedural synthesis): celeste/glockenspiel lead, soft
  plucked harp/guitar arpeggios, warm woodwind pad (clarinet register), light
  hand-percussion; a low leaf-rustle noise bed as the forest layer.
- Space: intimate but airy — medium soft reverb, gentle stereo drift like
  leaves on the wind.

# Citations

- `src/environment/biomes/autumn/biome.ts` — definition
- `src/environment/biomes/autumn/flora.ts` — tree/oak/rock/mushroom + floor decor builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Water](/environment/water.md) — shallow/deep tint plumbing
