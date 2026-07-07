---
type: Subsystem
title: Circuits
description: "Procedural closed-loop circuit generation: anti-oval gate, fillet arcs, validation."
tags: [terrain, circuits, procedural]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

## generateCircuit(seed)

Deterministic closed-loop generation producing circuits 588–1530 m long
(`LEN_MIN = 588`, `LEN_MAX = 1530`). Radii pinned by arc construction (floor 12.5).

Accept gate: **valid AND interesting** (anti-oval). Rejects oval-like shapes
that pass structural validation but lack character.

## validateCircuit

Checks:

- Minimum turn radius
- Tiered-separation (no overlapping lanes at different circuit levels)
- Self-intersection
- Corner metrics (count and sharpness distribution)

## buildMainline Pipeline

```text
scatter → hull → fillet arcs → keyhole hairpins/chicanes → displace → relax
```

| Stage       | Purpose                                       |
| ----------- | --------------------------------------------- |
| scatter     | Random control points in annular region       |
| hull        | Convex hull of scattered points               |
| fillet arcs | Rounded corners with minimum radius guarantee |
| keyholes    | Hairpin turns and chicanes for character      |
| displace    | Perlin noise displacement of control points   |
| relax       | Laplacian smoothing to eliminate artifacts    |

## Elevation + water clearance

The elevation profile is a zero-mean sinusoid (`amp ∈ [2, 6]`, scaled by
target length) over the XZ control points, then a coherence pass converges
heights of XZ-near arc-far pairs (hairpin legs). `heightAt` is single-valued,
so the road must avoid the water plane rather than bridge it.

`generateCircuit(seed, traits, waterLevel?)` lifts the floor: when a water
level is supplied, control-point Y is clamped to
`waterLevel + ROAD_WATER_CLEARANCE` (1.5 m) AFTER coherence, so the playable
surface (`pathY`) and its branches (which linearly/smooth-step interpolate
mainline Y) never submerge. `Game.buildWorld` passes the effective water
level (`biome.waterLevel ?? terrainCfg.sandLevel`, matching
`Terrain.waterLevel`). Undefined `waterLevel` leaves the legacy unconstrained
profile; the 5000-seed validity sweep runs without it (XZ-only acceptance is
unaffected, so the same attempt is chosen either way).

## circuitShape.ts

2D loop primitives (arc segments, straight lines, spline interpolation)
consumed by the `buildMainline` pipeline stages above. See
[circuit-shape.md](circuit-shape.md).

## trackGraph.ts

SampleIndex bucket grid providing:

- `nearestSample(x, z)` — returns the **index** of the nearest sample (not the
  position), expanding-ring search, O(1) amortized
- `forEachWithin(pos, radius, fn)` — radius query

Accelerates SplineFieldCache bake from O(n²) to sublinear.

# Citations

- [SplineTrack](/terrain/spline-track.md)
- [RaceManager](/race/race-manager.md)
