---
type: Subsystem
title: SplineTrack
description: Closed-loop spline providing spawn points, AI pathing, race logic, and minimap source.
tags: [terrain, spline, race]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

SplineTrack is the closed-loop CatmullRomCurve3 and single source of truth for:

| Consumer     | Usage                      |
| ------------ | -------------------------- |
| Spawn system | Start-grid positions       |
| AI drivers   | Path-following targets     |
| Race logic   | Lap counting and progress  |
| Checkpoints  | Segment crossing detection |
| Minimap      | Track outline rendering    |

Game passes spline `t` poses to race systems. Race code avoids DOM, physics,
and Three scene ownership — it receives only spline poses.

## Key Properties

- 1024 arc-length samples (`DEFAULT_SAMPLES = 1024`) in public `Float32Array`
  arrays: `sx`, `sy`, `sz`, `st` (world X/Y/Z + arc-length param `i/N`).
- `SampleIndex` (trackGraph.ts) indexes these arrays for sublinear `nearestSample`.

## Key Methods

- `getPoint(t, out?)` → `Vector3` (position only, no orientation).
- `pointAtArc(meters, out?)` → `Vector3` at arc-distance along the loop.
- `startPos(out?)` → `Vector3` of the first control point.
- `startYaw()` → `number` heading of the first segment.
- `closestPoint(x, z, out?)` → `ClosestPathPoint {dist, pathY, t, x, y, z}`.
  O(N) scan per call.

## SplineFieldCache

O(1) runtime query mechanism that bakes a uniform grid from `SampleIndex` at
build time. `queryPose(x, z)` returns `FieldPose {dist, t}` — the O(1)
equivalent of `closestPoint` for hot-path AI/race queries. Direct
`closestPoint` is O(N) and should be avoided on the hot path.

## Checkpoints / Lap Logic

`advanceLap(state, currT, k)` in `race/checkpoints.ts` tracks sector
crossings and returns `{state, lapCompleted, cut}`. Pure function — takes
the current `LapState` and wrapped `t`, returns a new state plus events.

# Examples

```ts
// Get world position at arc-distance along the loop
const pos = spline.pointAtArc(42, out);

// Query arc-length param t from cache, then look ahead for AI
const fp = cache.queryPose(kartX, kartZ);
const meters = fp.t * spline.loopLength;
const ahead = spline.pointAtArc(meters + lookAheadMeters, out);
```

# Citations

- [Circuits](/terrain/circuits.md)
- [RaceManager](/race/race-manager.md)
- [AiDriver](/race/ai-driver.md)
- [Checkpoints](/race/checkpoints.md)
