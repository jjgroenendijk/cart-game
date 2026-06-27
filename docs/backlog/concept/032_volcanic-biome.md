# 032 Biome: Volcanic

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. A volcanic world: lava, basalt, ash, embers, dark
rock, red sky. Pure data on the registry -> a `BiomeDefinition` + a
`flora/volcanic.ts` set; no engine change.

## Goal

Register a Volcanic biome, visually distinct from Badlands + Desert:

- Terrain: dark basalt palette; rugged moderate relief; rock dominates.
- Flora: basalt-rock (big, ball), dead-tree (big, cylinder), ember-shrub
  (decor); sparse, charred.
- Weather: clear + ash-fall + ember drift; hot dry haze.
- Water: lava (visual only - recolored water plane, red/orange tint; NO
  buoyancy/drain - lava is cosmetic, not deadly, to stay in scope).
- Sky/fog bias: dark red/orange sky; ash haze.

## Needs refinement

- Lava as cosmetic water recolor vs gameplay: keep lava cosmetic (no damage) to
  stay data-only; a "lava damages/respawns" rule is a gameplay change -> out of
  scope, later item.
- Ash-fall weather: new preset (downward dark particles) vs reuse snow with a
  tint -> decide; ember drift (upward additive points) may need a custom
  particle path.
- Dead-tree + basalt silhouette -> cel reads at distance.
- Dark palette vs cel-band readability (night floor in dayCycle) -> verify
  lighting keeps bands readable.

## Depends on

025 (framework). 018 (water plane - recolor only, no drain). Coordinate with
OPEN 021 (colorAt palette).
