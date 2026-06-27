# 033 Biome: Beach / Coast

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. A beach/coast world: sandy shore, dunes, palms,
driftwood, shallow turquoise water. Pure data on the registry -> a
`BiomeDefinition` + a `flora/beach.ts` set; no engine change. Distinct from
Tropical (030): beach is open shore + dunes + water, tropical is dense
interior jungle.

## Goal

Register a Beach/Coast biome, visually distinct from Tropical + Desert:

- Terrain: warm sand palette; low dune relief; large shallow water area.
- Flora: palm (big, cylinder), driftwood (big, cylinder/box), dune-grass
  (decor), sea-rock (big, ball); sparse-to-moderate.
- Weather: clear-heavy + light sea rain; bright.
- Water: large shallow turquoise (pale teal tint); buoyancy active but shallow.
- Sky/fog bias: bright turquoise/azure; sea haze.

## Needs refinement

- Large water area vs drivability: keep the corridor on land; water is
  off-track scenery (buoyancy recover loop from 018 must stay playable if a
  kart strays in).
- Dune-grass as InstancedMesh decor (swaying?) -> decide on motion vs cost.
- Driftwood collider shape (cylinder/box) -> pick a fair simple collider.
- Sky/turquoise water palette tuning vs cel look.

## Depends on

025 (framework). 018 (water buoyancy). Coordinate with OPEN 021 (colorAt
palette).
