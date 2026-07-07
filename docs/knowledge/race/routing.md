---
type: Subsystem
title: Routing Engine
description: Route-walking over the track graph; cursor, respawn, and branch choice.
tags: [race, routing, ai]
timestamp: 2026-07-07T00:00:00Z
---

# Schema

Two pure modules over the track graph; no Game/physics/DOM deps -> jsdom-testable.
`src/race/routing.ts` walks an edge-local cursor along a planned route; `src/race/routeChoice.ts`
decides whether a rival takes a branch. FieldBuilder applies respawn poses to Rapier bodies and
feeds `samplePathAhead` output to `AiDriver` as its `ahead` horizon.

A route is a `RoutePlan = ReadonlyMap<number, boolean>` mapping branch edge id -> take? Walking
is edge-local: on the mainline a taken split diverts the cursor onto the branch at its entry; a
branch that runs out continues on the mainline past its merge node.

## RouteCursor

Mutable edge-local position for route walking.

| Field    | Role                                         |
| -------- | -------------------------------------------- |
| `edgeId` | Current graph edge id (0 = mainline loop)    |
| `s`      | Arc distance along the edge (m / loop `t×L`) |

## advanceOnRoute

`advanceOnRoute(graph, plan, cur, meters)` advances `cur` by `meters` of arc along the planned
route (mutates + returns `cur`). On the mainline, the nearest taken split within reach diverts
onto its branch at `s = 0`; on a branch past its end, continues on the mainline at the merge
node. A `guard` caps edge transitions per call at 8 (routes never need more).

Closed mainline `s` wraps via `wrapArc` to stay in `[0, loopLength)`.

## samplePathAhead

`samplePathAhead(graph, plan, edgeId, s, stepM, buf, scratch?)` fills `buf` with
route-following lookahead samples spaced `stepM` apart, starting one step past `(edgeId, s)`.
Writes `{x, z, halfWidth}` per slot — `AiDriver`'s horizon shape. Allocation-free given a
pooled `scratch` point; each slot is mutated in place.

## Respawn

`respawnPoseOnGraph(world, x, z, clearance, aheadM = RESPAWN_AHEAD_M)` returns an edge-local
respawn pose ahead of the kart's nearest centerline station. Walks with NO plan (continue the
current edge): a kart lost beside a branch respawns ON that branch; past the merge node it is
back on the mainline. Yaw aligns kart forward (-Z) with the edge tangent; `clearance` lifts
off the surface.

`GraphWorld` is the minimal surface this needs (`graph`, `graphPose`, `heightAt`); `Terrain`
satisfies it.

## Route choice

`src/race/routeChoice.ts` decides whether a rival takes a branch. Pure and deterministic in
`(info, tuning, rng sequence)`; FieldBuilder seeds one RNG per (rival, branch) so every rival
commits to a stable route per world.

`BranchChoiceInfo`: `kind: "shortcut" | "scenic"`, `halfWidth` (corridor half-width, m),
`lengthRatio` (branch length / mainline window arc; `< 1` shorter, `> 1` longer).
`RouteTuning`: `aggression` 0..1 (higher = braver); `AiTuning` satisfies it.

`branchTakeProbability(info, tuning)`:

- Shortcut — attracts aggressive drivers and rewards shortness, narrowness deters:
  `p = 0.2 + 0.55·aggression − 0.3·narrow + 0.35·shorter`.
- Scenic — inverts: cautious drivers prefer the wide, easy road and eat the extra distance:
  `p = 0.75 − 0.5·aggression + 0.15·wide − 0.25·longer`.

Clamped to `[P_MIN, P_MAX]` — every rival can always surprise, never certainty.
`chooseBranch(info, tuning, rng)` consumes one `rng.next()` draw against that probability.

## Constants

| Constant          | Value | Role                                                |
| ----------------- | ----- | --------------------------------------------------- |
| `RESPAWN_AHEAD_M` | 15    | Respawn distance along the edge past station (m)    |
| `P_MIN`           | 0.05  | Take-probability floor (rivals can always surprise) |
| `P_MAX`           | 0.95  | Take-probability ceiling (never certainty)          |

## AiDriver consumption

`AiDriver.produceInput` is pure-pursuit toward a speed-scaled point on the spline; it does not
walk the graph itself. FieldBuilder calls `samplePathAhead` each step with the rival's
`RouteCursor` and feeds the resulting `AiSplinePoint[]` as the `ahead` horizon. Respawn poses
from `respawnPoseOnGraph` are applied to the rival's Rapier body. See
[AiDriver](/race/ai-driver.md).

# Citations

- [AiDriver](/race/ai-driver.md)
- [RaceManager](/race/race-manager.md)
- [SplineTrack](/terrain/spline-track.md)
