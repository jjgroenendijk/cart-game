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
