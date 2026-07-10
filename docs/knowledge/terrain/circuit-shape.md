---
type: Subsystem
title: Circuit Shape
description: >
  Pure 2D loop primitives for circuit generation: arc construction, vertex
  relaxation, displacement.
tags: [terrain, circuit, geometry]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`src/terrain/circuitShape.ts` provides mathematical 2D polygon primitives
consumed by `circuitGen.ts`'s `buildMainline` pipeline. All functions operate
on closed CCW loops of `V2 = [number, number]` points in metres. Pure,
jsdom-testable, no WebGL deps.

## Core Primitives

| Export            | Purpose                                     |
| ----------------- | ------------------------------------------- |
| `convexHull(pts)` | Graham scan convex hull of scattered points |
| `signedArea(pts)` | Shoelace signed area (>0 = CCW)             |
| `perimeter(pts)`  | Chord perimeter of a polygon loop           |
| `prefixArc(pts)`  | Cumulative chord-arc prefix + total length  |
| `turnAt(pts, i)`  | Signed exterior turn at vertex i (radians)  |

## Arc Construction

`filletCorners(pts, rng, mix?)` replaces polygon corners turning more than
`FILLET_MIN_TURN (0.15 rad)` with sampled circular arcs via `arcPoints`.
Per-corner radius is drawn from three tiers (hard 16-24 m, medium 26-42 m,
sweeper 46-75 m) weighted by a `CornerMix` (`DEFAULT_CORNER_MIX` =
35/40/25, the pre-archetype mix; layout archetypes pass their own weights)
and capped by arm length (`FILLET_ARM_BUDGET = 0.42`, max 36 m). The draw
always consumes exactly two rng values per corner regardless of tier or
mix, so taming retries and different mixes stay draw-aligned. The arc
sampling guarantees the actual turn radius floors at `FILLET_R_FLOOR (13)`.

`dropSpikes(pts)` removes vertices too sharp to fillet at the radius floor,
running up to 3 passes.

## Relaxation

`smoothLoop(pts, iters, factor)` — Laplacian smoothing: each point is nudged
toward the midpoint of its cyclic neighbours. Two light passes kill
displacement kinks; the taming loop in `circuitGen.ts` raises `factor` on
retries.

`relaxTwoTier(pts, iters)` — two-tier push-apart keyed on chord-arc gap.
Far-in-arc pairs (>140 m) shoved to >=34 m separation; near pairs (60-140 m,
hairpin legs) to >=20 m so folds survive. Prevents unrelated sections from
tearing the field cache.

## Displacement

`displaceOnce(pts, frac, rng)` inserts a midpoint on each span displaced
perpendicular by a signed fraction of edge length. Adjacent midpoints
flipping sides create S-bends. Spans below `DISPLACE_MIN_SEG (30)` are
skipped to preserve fillet/apex arc fidelity.

## Span Control

`subdivideLong(pts, maxSeg)` inserts evenly spaced points on spans longer
than `MAX_SEG (42)`. `enforceMinEdge(pts, minEdge)` drops control points
closer than `MIN_EDGE (16)` to a kept neighbour, keeping spans even and
preventing centripetal Catmull-Rom kinks.

`rayClearance(pts, origin, dir, skip)` computes min positive distance to any
non-adjacent edge, bounding hairpin fold depth.

## Curve Length

`curveLengthXZ(pts)` returns the closed centripetal Catmull-Rom XZ length
from the control polygon (`LENGTH_DIV = 512` arc-length divisions).

## See Also

- [Circuits](circuits.md) — `circuit.ts` + `circuitGen.ts` pipeline
- [SplineTrack](spline-track.md) — curve consumer for AI/race/map
