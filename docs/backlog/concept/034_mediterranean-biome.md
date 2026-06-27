# 034 Biome: Mediterranean / Golden Hills

Status: open (concept - to be refined)

## Context

Biome on the 025 framework. A sunlit Mediterranean/golden-hills world (the
Toussaint vibe): vineyards, cypress + poplar, warm golden grass, lavender,
vibrant warm sky. Pure data on the registry -> a `BiomeDefinition` + a
`flora/mediterranean.ts` set; no engine change. Distinct from Temperate:
warmer, drier, golden palette + cypress/poplar silhouettes.

## Goal

Register a Mediterranean/Golden-Hills biome, visually distinct from Temperate

- Tropical:

* Terrain: golden palette; gentle rolling hills (low-moderate amp); warm grass
  dominates.
* Flora: cypress (big, cylinder, tall narrow), poplar (big, cylinder), vine-
  row (decor), lavender (decor), olive-rock (big, ball); moderate counts.
* Weather: clear-heavy + warm haze; rare light rain.
* Water: minimal (streams; low level).
* Sky/fog bias: warm golden (amber horizon, deep warm blue zenith).

## Needs refinement

- Cypress (tall narrow) + poplar silhouettes -> cel reads at distance; >=2
  lump silhouette.
- Vine-row + lavender as InstancedMesh decor -> row placement along the
  corridor vs the jittered grid sampler; decide if a row sampler is needed
  (scope) or jittered is acceptable.
- Golden palette tuning vs cel bands (warm light + warm surface -> band crush
  risk); verify dayCycle start keeps it lit.
- Warm-haze weather (fog tint) vs a new preset -> decide.

## Depends on

025 (framework). 004 (sampler - possible row placement). Coordinate with OPEN
021 (colorAt palette).
