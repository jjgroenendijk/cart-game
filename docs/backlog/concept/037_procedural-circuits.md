# 037 Procedural circuits

Status: open (concept - to be refined)

## Context

Split from the biome discussion (025). `SplineTrack` (003) is config-driven
(`TerrainOptions.control` `Terrain.ts:30-31`) BUT the closed-loop control
points are hand-authored - one fixed circuit. 020 (track select) needs >1
circuit; 023 is infinite terrain, not track. A procedural circuit = generate
the spline control points from a seed so every race can be a fresh, drivable
loop. Composes with 025 (a generated circuit + a chosen biome = a track).

## Goal

- Seeded control-point generator: pure `generateCircuit(seed, opts)` -> a
  closed Catmull-Rom loop feeding `SplineTrack`. Bounded length, varied
  elevation, feature mix (straights, sweepers, hairpins).
- Drivable by construction: min turn radius above the kart's handling floor;
  no self-intersection; start/finish placement sane.

## Needs refinement

- Curvature limits vs `KartController` tuning (`KartController.ts:28-47,98-103`
  DEFAULT_TUNING) -> derive a hard min radius so AI + humans can actually drive
  it.
- Non-self-intersection algorithm for a closed loop (segment-crossing reject +
  re-roll, or a polar/angle-monotone generator).
- Elevation model (flat vs rolling vs alpine) -> interacts with 025 biome +
  003 pathY.
- Feature vocabulary + difficulty tiers; how `opts` maps to them.
- Feeding `SplineTrack` (`SplineTrack.ts:56-59`) -> confirm the control format
  - that checkpoints (007, derive from spline) + AI line (`AiDriver`) hold on
    a generated loop.
- Where the seed/opts come from at runtime (020 select surface; a seed input).

## Depends on

003 (SplineTrack). 007 (checkpoints + AI derive from the spline -> must stay
drivable on generated loops). 020 (track select consumes generated circuits).
025 (biome composes; circuit + biome = track). Independent of 004-006/010.
