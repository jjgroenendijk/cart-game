# 036 Biome: Autumn Forest

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. An enchanted autumn-forest world (the fairy-tale
realm vibe): golden/red/orange foliage, mystical soft light, leaf-fall, mossy
floor. Pure data on the registry -> a `BiomeDefinition` + a `flora/autumn.ts`
set; no engine change. Distinct from Temperate (001/004 baseline): autumn
palette + leaf-fall + denser canopy, more atmospheric.

## Goal

Register an Autumn Forest biome, visually distinct from Temperate:

- Terrain: autumn palette (amber grass, mossy rock); moderate relief; dense
  canopy.
- Flora: autumn-tree (big, cylinder, orange/red/gold foliage), moss-rock (big,
  ball), mushroom (decor), fern (decor); dense counts.
- Weather: clear + leaf-fall + soft mist; calm.
- Water: cool streams (low level, amber-tinted).
- Sky/fog bias: soft warm diffuse (golden diffuse, soft mist); magical mood.

## Needs refinement

- Leaf-fall weather: drifting leaf particles (slow, tumbling, colored) -> a new
  preset variant; decide custom particle vs reuse snow with tint + slower fall.
- Autumn-tree multi-color foliage (orange/red/gold) -> per-instance vertex
  color from seed (extend the tree builder); cel reads at distance.
- Mushroom decor geometry + counts.
- Soft mist (fog) vs cel-band readability -> verify the mood does not crush
  bands.

## Depends on

025 (framework). 004 (flora builder - per-instance foliage color). Coordinate
with OPEN 021 (colorAt palette).
