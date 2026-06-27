# 030 Biome: Tropical / Jungle

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. A lush tropical/jungle world: palms, ferns, dense
foliage, warm rain, vivid saturated sky. Pure data on the registry -> a
`BiomeDefinition` + a `flora/tropical.ts` set; no engine change.

## Goal

Register a Tropical/Jungle biome, visually distinct from Temperate + Swamp:

- Terrain: vivid green palette; moderate relief; dense foliage everywhere.
- Flora: palm (big, cylinder), fern (decor), tropical-shrub (decor), jungle-
  rock (big, ball); dense counts.
- Weather: warm rain + clear; vivid sky.
- Water: shallow warm (pale teal tint).
- Sky/fog bias: saturated bright (deep blue zenith, warm horizon).

## Needs refinement

- Flora geometry (palm trunk + fronds; fern frond clusters) -> cel silhouette
  reads at distance; >=2 lump silhouette like the temperate tree.
- Dense-flora draw-call budget -> verify PropField bucketing + InstancedMesh
  decor keep draw calls bounded (011/F3).
- Weather: warm rain variant vs 010 rain (heavier, warmer tint); decide
  whether to add a `warmRain` preset or reuse rain.
- Palette + density tuning vs playability (keep the corridor clear).

## Depends on

025 (framework). 011 (perf budget for dense flora). Coordinate with OPEN 021
(colorAt palette).
