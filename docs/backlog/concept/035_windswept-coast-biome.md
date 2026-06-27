# 035 Biome: Windswept Rocky Coast

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. A windswept rocky-coast world (the Skellige vibe):
rugged ocean cliffs, cold sea, wind-bent grass + pine, spray, overcast. Pure
data on the registry -> a `BiomeDefinition` + a `flora/coast.ts` set; no
engine change. Distinct from Beach (033): coast is cold rugged cliffs + ocean,
beach is warm sandy shore. Distinct from Alpine (028): coast is sea-level
cliffs, alpine is inland peaks.

## Goal

Register a Windswept Rocky Coast biome, visually distinct from Beach + Alpine:

- Terrain: cold grey-green palette; rugged cliff relief near the water
  (moderate amp), flatter inland.
- Flora: wind-pine (big, cylinder, leaning), coast-grass (decor), sea-cliff-
  rock (big, ball); sparse, wind-bent.
- Weather: overcast + sea-fog + spray; strong wind.
- Water: cold ocean (large, deep blue-green tint); buoyancy active.
- Sky/fog bias: cold overcast (steel-grey zenith, pale horizon); sea spray
  haze.

## Needs refinement

- Wind-bent / leaning flora geometry -> decide if lean is a per-instance
  rotation (cheap, data) or authored geometry (scope); prefer rotation.
- Cliff relief near water vs drivability + the world edge (023 removes walls)
  -> verify the corridor is not cliffed off.
- Sea-spray weather (fine mist particles + wind) vs reuse fog -> decide; strong
  wind already exists in Weather windSpeed.
- Cold palette + overcast vs cel-band readability -> verify lighting.

## Depends on

025 (framework). 018 (water buoyancy). Coordinate with OPEN 021 (colorAt
palette).
