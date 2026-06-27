# 031 Biome: Badlands / Canyon

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. A badlands/canyon world: red-rock mesas, slot
canyons, dust, sparse scrub. Pure data on the registry -> a `BiomeDefinition`

- a `flora/badlands.ts` set; no engine change.

## Goal

Register a Badlands/Canyon biome, visually distinct from Desert + Volcanic:

- Terrain: red-rock palette; high-frequency mesas + gullies (moderate-high amp,
  higher freq); rock dominates on cliffs.
- Flora: scrub-brush (decor), juniper (big, cylinder), mesa-rock (big, ball);
  sparse.
- Weather: clear + dust devil/dust haze; dry.
- Water: none / arroyo (dry).
- Sky/fog bias: dusty warm (orange horizon, haze).

## Needs refinement

- Mesa/canyon relief vs drivability: high-frequency vertical relief can create
  undriveable walls off-track -> tune noise so the corridor + near-off-track
  stay drivable; verify kart does not get stuck.
- Red-rock palette vs rockSlope (rock shows everywhere on cliffs) -> tune.
- Slot-canyon feel may need taller, narrower features than simplex octave sum
  gives -> decide whether a custom height profile is needed (possible scope
  creep; prefer data-only first).
- Weather: dust haze (fog tint) vs a new `dust` preset -> decide.

## Depends on

025 (framework). Coordinate with OPEN 021 (colorAt palette).
