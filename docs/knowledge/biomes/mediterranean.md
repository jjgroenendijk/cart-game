---
type: Concept
title: Mediterranean — Art & Vibe Guide
description: "Sunlit golden-hills vineyard country: dry grass, cypress spires, lavender, warm haze."
tags: [biomes, art-direction, vibe, mediterranean]
timestamp: 2026-07-24T00:00:00Z
---

# Identity

Sun-drenched southern hill country in high summer — broad golden slopes of dry
grass, vineyard rows following the contours, dark cypress spires and pale
poplars standing against a deep warm blue sky, lavender and sun-bleached
limestone underfoot. Warm, dry, generous light; the air itself carries an amber
haze over the far ridges. Painted Wilds realism: real midsummer sun on real dry
grass, never a postcard.

Distinct from temperate (that one is green, damp, and cool-shaded; this is
golden and dry) and from beach/tropical (inland hills — water is a thread in a
gully, never the headline). Cypress and poplar are the identity: two narrow
vertical silhouettes over horizontal golden slopes.

Vibe words: golden, dry, sunlit, cultivated, hazy.

# Palette anchors

From `src/environment/biomes/mediterranean/biome.ts`:

| Slot          | Hex       | Reads as                    |
| ------------- | --------- | --------------------------- |
| road          | `#54452f` | packed dry-earth farm track |
| grass         | `#8a7b2e` | golden summer-dry grass     |
| sand          | `#bfa876` | pale limestone dust         |
| rock          | `#857a60` | warm weathered limestone    |
| water surface | `#8fbfae` | warm green-blue stream      |
| water shallow | `#5fae9a` | clear water over stone      |
| water deep    | `#1c4a44` | shaded pool green           |

Every albedo here runs DARKER than the colour it is meant to read as: under a
high sun (intensity ~1.65 plus ambient) a warm mid-value albedo tonemaps to pale
cream, which is the band-crush risk of a golden palette. Grass is a deep ochre
so the lit slope lands golden; the road goes dark earth and the limestone a
muted warm grey so both hold contrast against it. The one deep green in the
biome is cypress foliage; everything else is dusty. Flora builders live in
`src/environment/biomes/mediterranean/flora.ts`.

# Flora set

Per streamed chunk (big-prop sum 7, cap 8):

- `cypress` (3, big) — tall narrow dark-green spire, `coniferTree` with a slim
  tier radius; clustered (up to 3 within 5 m) so they read as short avenues.
- `poplar` (2, big) — tall pale-barked column, `canopyTree` with a small canopy
  radius and low jitter so the crown stays narrow.
- `oliveRock` (2, big) — low sun-bleached limestone boulder (`ballRock`).
- `vineRow` (10, decor) — bespoke trellis segment: three stakes carrying one
  trained vine hedge (separate clumps read as floating blobs at kart speed).
- `lavender` (18, decor) — crossed blades alternating violet spike and
  grey-green foliage.

Vineyard rows without a row sampler: the row read lives in the vineRow PROP (a
~2.6 m trellis section), not in placement, so the shipped jittered-grid sampler
scatters row segments at varied headings and no new sampler is needed. Cypress
and poplar were checked for the silhouette rule — both hold a narrow,
multi-lump vertical profile taller than twice their width at every seed
(pinned in `src/environment/biomes/mediterranean/flora.test.ts`).

# Light & sky

`skyFogBias`: the warm golden register. Fog and horizon go amber so far ridges
dissolve into summer haze; the zenith holds a deep warm blue; sun and ambient
carry a soft warmth so shaded sides stay warm-bounced rather than cold.
`factor` 0.30 because the fog tint does the heavy lifting: past ~60 m
(`fogNear` 90 / `fogFar` 360 plus aerial perspective) the hills are
fog-dominated, so distant golden comes from the haze colour, not from terrain
albedo. The tint is kept mid-value — a bright haze bleaches the far hills to
cream. Light tints stay gentle: warm light on a warm surface is exactly where
value separation is lost first.

# Weather habits

Clear-dominant (0.75) — this is a high-summer biome. `heatHaze` (0.15) carries
the shimmering warm haze over the hills; `warmRain` (0.10) is a rare short
shower that passes without cooling the register. Both are shipped presets: warm
haze needed no new preset, only the existing dry-heat field plus the amber fog
tint the biome already supplies. Nothing cold ever reaches these hills.

# Water

Minimal by design: `waterLevel: -6` sits below `sandLevel` (-5), so water only
fills the deepest gullies as streams. The corridor stays dry, and the water
tints are tuned for a shallow stream bed rather than open depth.

# Track character

Rolling vineyard road: the default width band with moderate breathing, flowing
sweepers favoured over hairpins, real elevation (`elevationScale` 1.15) plus a
guaranteed climb/descent per lap (`hillBias` 0.4) so the road rides the hills
rather than cutting through them. Occasional scenic forks wander off between the
rows.

# Music direction (future audio)

- Mood: warm, sunlit, unhurried but alive; midday over cultivated hills.
- Tempo: moderate (100–112 BPM feel), lilting rather than driving.
- Mode: major with occasional modal (Mixolydian/Phrygian) colour for the
  southern accent.
- Timbre targets (procedural synthesis): nylon-string plucked lead, warm bowed
  pad as the heat-haze layer, light hand percussion, cicada-register noise bed
  that thins in the wet.
- Space: dry and open — short natural reverb, wide but not cavernous; the air
  is hot and still, not echoing.

# Citations

- `src/environment/biomes/mediterranean/biome.ts` — definition
- `src/environment/biomes/mediterranean/flora.ts` — cypress/poplar/oliveRock + vineyard decor
- [Biome framework](/biomes/framework.md) — schema, registry, index
- [Art Direction — Painted Wilds](/conventions/art-direction.md)
