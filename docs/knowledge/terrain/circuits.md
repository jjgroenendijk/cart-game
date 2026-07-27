---
type: Subsystem
title: Circuits
description: "Procedural closed-loop circuit generation: anti-oval gate, fillet arcs, validation."
tags: [terrain, circuits, procedural]
timestamp: 2026-07-27T10:30:00Z
---

# Schema

## generateCircuit(seed)

`generateCircuit` consumes per-biome `TrackTraits` (width band, branch
chance, branch bias) from `src/terrain/trackTraits.ts`. See
[Track Traits](/terrain/track-traits.md).

Deterministic closed-loop generation producing circuits 588–1530 m long
(`LEN_MIN = 588`, `LEN_MAX = 1530`). Radii pinned by arc construction (floor 12.5).

Accept gate: **valid AND interesting** (anti-oval). Rejects oval-like shapes
that pass structural validation but lack character.

## Layout archetypes (084)

Each seed draws a `LayoutArchetype` (`drawArchetype`, own sub-seed like the
width draw, weighted by `traits.archetypeWeights`) before its attempts:

| Archetype | Personality          | Key base knobs                                       |
| --------- | -------------------- | ---------------------------------------------------- |
| classic   | balanced generic mix | the `tamedOpts` recipe (default knobs)               |
| flow      | sweepers, esses      | mix 10/35/55, folds 0-1, chicanes 3-4, scatter 11-16 |
| technical | dense corners        | mix 60/32/8, folds 2-3, chicanes 5-6, scatter 14-20  |
| power     | straights + hairpins | elong 1.35-1.7, folds 1-2, chicanes 2-3, 900-1480 m  |

`MainlineOpts.scatterRange` sets the hull's scatter-point count (corner
density; default [9, 14] reproduces the classic draw). `archetypeOpts(a, t)`
lerps every knob from the personality base (t = 0) to
the same gentle endpoint `tamedOpts` converges to (t = 1), so taming and
termination behavior are archetype-independent; the fallback draw stays the
classic recipe. Early attempts (< 6) must pass a per-archetype signature
gate (flow: >= 2 esses + 6 corners; technical: hairpins + >= 8 corners;
power: >= 150 m straight + a hairpin);
attempts 6-7 use the generic anti-oval gate, >= 8 accept plain-valid.
`GeneratedCircuit.archetype` reports the personality; the 5000-seed sweep
asserts per-archetype distribution floors. Corner tier weights are a
`CornerMix` (see [Circuit Shape](/terrain/circuit-shape.md)).

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

| Stage       | Purpose                                             |
| ----------- | --------------------------------------------------- |
| scatter     | Random points inside a rotated ellipse              |
| hull        | CCW convex hull of scattered points                 |
| fillet arcs | Rounded corners with minimum radius guarantee       |
| keyholes    | Hairpin turns and chicanes for character            |
| displace    | Signed, RNG-driven perpendicular midpoint offsets   |
| relax       | Laplacian smoothing plus two-tier separation pushes |

## Elevation + water clearance

The elevation profile is a zero-mean three-harmonic sinusoid (`amp ∈
[3, 12]`, scaled by target length and `MainlineOpts.elevAmpScale`; the third
harmonic at 2.6-4.2 cycles adds short-cycle undulation) over the XZ control
points, plus an optional guaranteed 1-cycle climb/descend harmonic weighted
by `MainlineOpts.elevHillBias` (0..1). Elevation character also varies PER
SEED: `generateCircuit` draws from an elevation sub-seed (like the archetype
and width draws) a scale in [0.75, 1.5] multiplied into the biome/archetype
`elevAmpScale`, and ~30% of seeds add a hill bias of 0.35-0.8 — calm seeds
and mountain seeds coexist within one biome. A coherence pass then converges
heights of XZ-near arc-far pairs (hairpin legs). `heightAt` is
single-valued, so the road must avoid the water plane rather than bridge it.

Grade is capped explicitly: `MAIN_GRADE_MAX = 0.14` (rise per metre of XZ
arc, below `BRANCH_GRADE_MAX = 0.2`) is enforced on the control ring by a
raise-only relaxation (`relaxGrade`, after coherence — raising the lower
point of a violating pair never sinks a valley, so the later water floor is
preserved). The accept gate in `generateCircuit` additionally rejects
attempts whose sampled `maxGrade` exceeds `ACCEPT_GRADE = 0.18` (headroom
for Catmull-Rom overshoot between control points); `CircuitAnalysis`
carries `maxGrade`.

`generateCircuit(seed, traits, waterLevel?)` lifts the floor: when a water
level is supplied, control-point Y is clamped to
`waterLevel + ROAD_WATER_CLEARANCE` (1.5 m) AFTER coherence + grade relax,
so the playable surface (`pathY`) and its branches (which linearly/
smooth-step interpolate mainline Y) never submerge. Flooring only flattens
valleys, so it can never raise `maxGrade`. `Game.buildWorld` passes the
effective water level (`biome.waterLevel ?? terrainCfg.sandLevel`, matching
`Terrain.waterLevel`). Undefined `waterLevel` leaves the legacy
unconstrained profile; the 5000-seed validity sweep runs without it.

## circuitShape.ts

2D loop primitives (arc segments, straight lines, spline interpolation)
consumed by the `buildMainline` pipeline stages above. See
[circuit-shape.md](circuit-shape.md).

## trackGraph.ts

`TrackEdge` + `TrackGraph` (mainline + branch edges, below). `SampleIndex`
(the uniform XZ bucket grid) now lives in `sampleIndex.ts` and is
re-exported here; it provides:

- `nearestSample(x, z)` — returns the **index** of the nearest sample (not the
  position), expanding-ring search, O(1) amortized
- `forEachWithin(pos, radius, fn)` — radius query

Accelerates SplineFieldCache bake from O(n²) to sublinear.

### TrackEdge + TrackGraph data model (059/060)

`TrackEdge` is an equal-arc station table (world position + `halfWidth` per
station) with `pointAt` / `tangentAt` / `halfWidthAt(s)` / `progressAt(s)`,
each edge carrying its own `SampleIndex`. Edge 0 wraps the mainline
`SplineTrack` sample arrays (closed; station `t = i/count` bit-matches `st`);
branch edges are open, anchored at mainline params `tA`/`tB`, and `progressAt`
PROJECTS onto the mainline parameterization so race progress stays one scalar
`t`. `WidthProfile` (`{s[], halfWidth[]}`, `widthProfileAt`) is the
piecewise-linear per-station half-width; `DEFAULT_TRACK_HALF_WIDTH = 6` is the
single no-graph fallback. Station-profile primitives (the generic
`profileAt` sampler, `buildStationTable`, the `WidthProfile`/`BankProfile`
shapes) live in `src/terrain/stationProfile.ts`; `trackGraph.ts` re-exports
the width names so importers keep their paths.

`TrackGraph.closestOnGraph(x, z, out)` returns the TRUE nearest station over
all edges (one `SampleIndex` per edge) as a `GraphPose`
`{edgeId, s, dist, t, halfWidth, pathY}`. `pathY` is RIDGE-blended toward the
second-nearest DISTINCT edge inside `RIDGE_BLEND = 24` m so junctions stay
crease-free. `SplineFieldCache` bakes `{dist, pathY, t, halfWidth, edgeId}`
from the graph; same-edge bilinears keep a mainline `t` from blending with a
branch's projected `t`.

## trackMarkers.ts

`src/terrain/trackMarkers.ts` defines `TrackMarker` (edge-local annotation:
`edgeId`, `s`, `lateral`, `kind`) and `MarkerPose` interfaces.
`markerWorldPose(graph, marker)` projects a marker shape to a world pose
(centerline point + lateral offset along the edge right vector, yaw from
tangent). Currently a minimal/empty implementation — every circuit ships
an empty marker list.

# Citations

- [SplineTrack](/terrain/spline-track.md)
- [RaceManager](/race/race-manager.md)
