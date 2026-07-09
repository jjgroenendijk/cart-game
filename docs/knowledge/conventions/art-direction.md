---
type: Convention
title: Art Direction — Painted Wilds
description: "Painterly cel direction: soft bands, pigment palettes, warm line; nordic register."
tags: [art-direction, rendering, palette, convention]
timestamp: 2026-07-09T00:00:00Z
---

# Art Direction — Painted Wilds

The game's visual identity is "Painted Wilds": a hand-painted storybook world
rendered with soft cel shading — the register of Breath of the Wild by way of a
Ghibli background painting, pushed toward Skyrim / The Witcher 3 for mood. The
world reads painterly and grounded, never neon, never arcade-glossy. This doc is
the contract; subsystem docs own the mechanics.

Chosen against five alternatives (hard toon, outline-free matte, 16-color retro,
Moebius ink, neon night) because the pipeline already converges on it: cel bands
plus outlines (`src/materials/cel.ts`, `src/materials/outline.ts`), a posterized
painted sky (`src/materials/skyPosterize.ts`), and editorial journal menu chrome
(`src/ui/menuStyles.ts`).

## Pillars

- Painted, not printed: soft cel bands with AA edges, pigment-biased color,
  gentle atmospheric haze. No hard 2-band toon snap, no dither, no halftone.
- Mood is data: registers (warm morning vs nordic overcast) live entirely in
  palette / fog / light / sky tables, never in shader or pass forks. One shader
  runs a Ghibli morning and a Witcher overcast.
- Grounded fantasy: Skyrim / Witcher landscape moods — cold mist, mossy greens,
  snowlines, low raking sun — carried by the biome and day-phase tables.
- Procedural everything: zero committed media stays policy; all visual identity
  is code (shaders, palettes, css builders).

## Shading law

- Karts/props: cel shading, 3 diffuse bands + rim light (`src/materials/cel.ts`,
  `bands` default 3). Band count is identity; do not drop to 2 or raise past 4.
- Terrain: smooth lambert (no bands) — cel-quantizing height normals contours;
  see `src/materials/cel.ts` `SMOOTH_DIFFUSE` path.
- Bloom/glow, when added, must read as soft painted light (sun, glints), never
  neon emissives.

## Line law

- Both outline systems stay: inverted-hull shells on karts/props
  (`src/materials/outline.ts`) and the Sobel terrain pass
  (`src/materials/postOutline.ts`).
- Direction targets a warm dark line, not pure black: sepia `#3a2f28` for warm
  registers, near-iron `#2e2a26` for nordic ones, fading with distance on the
  Sobel pass. Current implementation still uses `0x000000` defaults; retuning
  the line color is open work, and new code must take the line color from the
  register table rather than hard-coding black.

## Color law

- Sky: painted zenith-to-horizon bands via `src/materials/skyPosterize.ts`
  (defaults zenith `0x4a8fcf`, horizon `0xfde8c0`); day-phase tables in
  `src/environment/dayCycle.ts`.
- Biomes (`src/terrain/biomes.ts`) bias toward pigment: olive/mossy greens,
  warm earth roads, grey-blue rock. Saturated primaries are reserved for
  gameplay reads (kart liveries, checkpoints, hazards) so they pop against the
  muted world (`src/kart/Kart.ts` palette).
- Nordic register anchors: overcast zenith `#5f6c7c` / horizon `#c4beac`, mist
  fog `#b6c0c2`, moss `#6e7c4e`, pine `#31503f`, snowline on high remote
  terrain, muted liveries (oxblood `#a8452f`, steel `#41707f`, brass accent
  `#c9a86a`). Alpine/tundra biome tables already carry most of this mood.
- Each biome may swing temperature and value; it may not introduce neon hues,
  pure black shadows, or unshaded flat fills.

## UI law

- Menus/overlays keep the biome-neutral editorial field-journal voice
  (`src/ui/menuStyles.ts`): serif masthead, tracked kickers, hairlines, grain,
  accent `#ffd23f`. The journal frames the painted world; it never goes arcade.
- Film grain may extend subtly from UI into the scene grade (about 10% of the
  menu strength) to unify chrome and world; HUD elements stay grain-free for
  readability.

## Register table (mood presets)

| Knob     | Warm (Ghibli/BotW)  | Nordic (Skyrim/Witcher) |
| -------- | ------------------- | ----------------------- |
| Sky      | blue -> cream bands | grey-blue -> pale khaki |
| Fog      | warm cream, light   | cold mist, dense        |
| Sun      | high, warm          | low, pale, raking       |
| Greens   | olive, lively       | mossy, desaturated      |
| Line     | sepia `#3a2f28`     | near-iron `#2e2a26`     |
| Liveries | saturated primaries | oxblood/steel/brass     |

Registers are per-biome (and per day phase) data. The nordic register is the
flagship mood for temperate/alpine/tundra; tropical keeps its golden-hour warm
register.

## Related

- [render-layers](/conventions/render-layers.md) — pass chain the direction rides on
- [cel-material](/materials/cel-material.md) — band shading mechanics
- [outlines](/materials/outlines.md) — hull + Sobel line systems
- [dynamic-sky](/environment/dynamic-sky.md) — sky dome + posterize
- [menu-styles](/ui/menu-styles.md) — editorial journal UI kit
