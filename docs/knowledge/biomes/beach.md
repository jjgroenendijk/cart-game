---
type: Concept
title: Beach — Art & Vibe Guide
description: "Bright-midday sandy coast: near-white dunes, turquoise shallows, deep open ocean."
tags: [biomes, art-direction, vibe, beach]
timestamp: 2026-07-17T00:00:00Z
---

# Identity

A bright-midday sandy shore under a high blue sky — dunes of near-white warm
sand, a prominent deep ocean fading from turquoise shallows to open blue.
Warm, open, sunlit, painted in the Painted Wilds register — real light on
real sand, never arcade-glossy. Distinct from tropical (golden-hour amber
dusk under leaning palms, lush and lazy — beach is noon, clean and wide open,
scrub not jungle) and from the windswept rocky coast (cold grey cliffs and
grey surf — beach is warm sand and turquoise, no chill). The one biome whose
water is the headline: shallows glow, the deep reads as real ocean.

Vibe words: bright, open, warm, sandy, turquoise.

# Palette anchors

From `src/environment/biomes/beach/biome.ts`:

| Slot          | Hex       | Reads as                   |
| ------------- | --------- | -------------------------- |
| road          | `#bfa878` | packed pale-sand track     |
| grass         | `#9caa66` | dune scrub                 |
| sand          | `#e8dcc0` | near-white warm sand       |
| rock          | `#9a8f7e` | weathered grey shore stone |
| water surface | `#9ad8d0` | pale turquoise tint        |
| water shallow | `#1fb6c8` | bright turquoise           |
| water deep    | `#06304a` | deep ocean blue            |

The water carries the biome: shallow-to-deep is the widest span of any shore
biome, so the ocean reads as depth, not a tinted flat. Sand is the light
anchor; scrub and stone stay muted so the turquoise never competes. Flora
builders live in `src/environment/biomes/beach/flora.ts`.

# Flora set

Sparse coastal silhouettes over shore decor, per streamed chunk (big-prop
sum 7, cap 8):

- `palm` (3, big) — bespoke leaning coconut palm; the shore's living
  vertical, tilted seaward.
- `driftwood` (2, big) — bespoke bleached weathered log, sun-greyed and
  tide-stranded; the signature beach prop.
- `seaRock` (2, big) — tide-worn stone, rounded and weathered grey.
- Decor: `duneGrass` 16, `shell` 8.

# Light & sky

`skyFogBias`: bright midday. Fog and horizon go pale sea-haze so the far
water dissolves into a hazy horizon band rather than a hard line; the zenith
holds a high clean blue and the sun stays warm and neutral-bright (no amber
dusk cast — that is tropical's register). The air reads clear and open, haze
only at the sea edge.

# Weather habits

Clear-dominant (0.78) — the bright open default. warmRain (0.12) is a light,
warm sea shower that passes fast; trace fog (0.10) is thin sea-haze rolling
off the water. No cold weather ever reaches this shore.

# Track character

Open flowing coastal road: wider than the twisty inland biomes, gentle and
sweeping with a flow/power bias and few branches — the shore is open, not a
maze. Long turquoise-fringed straights over short technical corners; the road
hugs the sand, not the trees.

# Music direction (future audio)

- Mood: bright, open, easy; midday sun on open water, unhurried but awake.
- Tempo: relaxed-upbeat (96–108 BPM feel), riding the beat, not behind it.
- Mode: bright major with open, airy voicings; clean diatonic phrases.
- Timbre targets (procedural synthesis): clean plucked lead (nylon/steel
  register), round warm bass, light shaker/brush percussion, airy sustained
  pad as the sky layer; broadband surf noise as the shore bed, higher and
  brighter in the mix than tropical's.
- Space: wide open-air — long airy reverb, broad stereo like an open horizon;
  no close reflections, nothing boxed.

# Citations

- `src/environment/biomes/beach/biome.ts` — definition
- `src/environment/biomes/beach/flora.ts` — palm/driftwood/seaRock + shore decor builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Water](/environment/water.md) — shallow/deep tint plumbing
