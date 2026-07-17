---
type: Concept
title: Badlands — Art & Vibe Guide
description: "Red-rock canyon country: eroded mesas, slot canyons, dust haze, dry arroyos."
tags: [biomes, art-direction, vibe, badlands]
timestamp: 2026-07-17T00:00:00Z
---

# Identity

Eroded red-rock badlands under a dust-drowned sky. Iron-oxide mesas and
slot canyons cut a hard, layered land; the air carries perpetual haze off
the dry arroyos. Painted in the Painted Wilds register — carved, ancient,
scoured. Distinct from desert (bleached gold, flat, open) and alpine (grey
granite, tall, cold). Water does not exist here (`waterLevel: -100`); the
arroyos run dry.

Vibe words: eroded, iron-red, layered, dusty, carved.

# Palette anchors

From `src/environment/biomes/badlands/biome.ts`:

| Slot  | Hex       | Reads as             |
| ----- | --------- | -------------------- |
| road  | `#8a5a3e` | packed clay track    |
| grass | `#9c7a4a` | dry canyon-floor mat |
| sand  | `#d8a878` | tan arroyo silt      |
| rock  | `#a0442c` | iron-oxide red butte |

Flora pigment aligns to the red-rock terrain (approximate; the actual
values live in `src/environment/biomes/badlands/flora.ts`): dusty grey-green
juniper, red butte rock, tan-brown scrub, dry-straw tuft. No lush green —
green reads as the last hardy survivor, not abundance; the red butte rock is
the biome's one saturated note.

# Flora set

Sparse giants over low scrub, per streamed chunk (big-prop sum 5, cap 8):

- `juniper` (2, big) — gnarled dry-canyon tree, the biome's living silhouette.
- `butteRock` (3, big) — iron-oxide red boulders/mesa knobs; the signature
  red rock of the badlands.
- Decor: `scrubBrush` 20, `dryTuft` 14.

# Light & sky

`skyFogBias`: fog toward warm dust `#d8a878`; the HORIZON warms to orange
`#d88a5a` while the ZENITH drains to a cool blue `#8fa8c0`. Fog and horizon
share a warm dust hue on purpose: the fully-fogged terrain edge dissolves
into the horizon band of the sky gradient, so a cool horizon would turn the
haze into a hard silhouette line instead of atmosphere. The drained zenith
keeps the sky from ever reading crisp — the dust is always in the air.

# Weather habits

Clear-dominant (0.8); sandstorm (0.15) rolls dust walls down the canyons as
the biome's one violent mood; trace heatHaze (0.05) keeps the arroyo air
wobbling.

# Track character

Canyon corridors: narrower (5–8.5) and twistier than the open desert, with a
technical bias (`archetypeWeights` weights `technical` 1.5). Frequent
branches (`branchChance` 0.7, balanced bias) fork the route through slot
canyons; `elevationScale` 0.9 keeps the mesa climbs pronounced. Corners are
the badlands' character; the walls are always close.

# Music direction (future audio)

- Mood: austere, weathered, resonant; the sound of wind over stone.
- Tempo: mid-slow (78–92 BPM feel), a walking dust-devil pulse.
- Mode: dorian / minor with open-fifth drones; hollow, canyon-echo intervals.
- Timbre targets (procedural synthesis): low bowed drone, dry frame-drum and
  rattle percussion, plucked resonator with long stone-slap decay, a thin
  reed line as the heat-haze layer.
- Space: hard early reflections (canyon walls) over a long tail — sound bounces
  before it fades; narrow-to-wide stereo as corridors open onto mesas.

# Citations

- `src/environment/biomes/badlands/biome.ts` — definition
- `src/environment/biomes/badlands/flora.ts` — juniper/butteRock + scrub decor builders
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
- [Weather](/environment/weather.md) — sandstorm/heatHaze presets
