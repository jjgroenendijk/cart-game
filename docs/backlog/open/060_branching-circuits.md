# 060 Branching circuits (split / rejoin)

Status: open (full plan; ready for execution). Stage 5 of 037 v3.

## Context

The headline feature: a circuit can split into two paths that rejoin - a
narrow, harder, shorter shortcut vs a wider, easier, longer detour - so route
choice becomes a gameplay decision. The single-edge graph (059) already
carries the data model; this stage adds branch edges plus the race/AI/terrain
integration.

The hard constraint is progress. The entire race stack (RaceManager,
`checkpoints.ts`, ranking, rubber-band, HUD, minimap) is built on one scalar
`t in [0,1)` along the closed mainline. Rather than re-key all of it, project
branch positions onto the mainline parameterization: a kart on a branch whose
endpoints anchor at mainline params `tA`/`tB` reports `t = wrapLerp(tA, tB,
s/branchLen)`. Progress is continuous and monotonic on either route and both
routes agree at the junctions, so every downstream consumer is unchanged. A
shorter branch accrues `t` faster per metre - correct, since `t` measures
fraction-of-lap, making route choice a pure time trade-off, not a rank exploit.

Guardrails that keep the single-`t` model valid:

- Branch windows confined to `t in [0.08, 0.92]` (start/finish + grid stay
  pure mainline) and <= 0.22 of the lap (< checkpoints FORWARD_CUT=0.34, so a
  cross-country hop between routes degrades to a normal sector move, not a
  false teleport).
- Min-separation SEP_MIN_BRANCH=26 m between a branch and any other centerline
  (outside 20 m junction disks). Carve influence is halfWidth+blendWidth<=17 m,
  so >=26 m keeps any on-road kart unambiguously closest to its own edge - the
  field cache never snaps progress to the wrong route.

Deferred and documented as out of scope: same-level crossroads (a crossing
point maps one (x,z) to two distant `t` values -> needs heading-aware pose
queries) and grade-separated bridges (`heightAt` is single-valued by the core
terrain invariant -> no stacked surfaces). The graph model does not preclude
either later.

## Goal

Some seeds produce a mainline with 1-2 branches; the world, terrain, race
logic, AI, minimap, and respawn all handle them. AI picks a route
deterministically per rival; both routes complete laps cleanly with correct
ranking that converges at the merge.

## Non-goals

- Crossroads / bridges (documented deferral above).
- Gameplay features on branches (items/boost) - only the `TrackMarker` data
  shape lands, empty.
- Branch difficulty tied to AI skill (-> 061); route choice uses per-rival
  personality only.

## Architecture (change)

```text
src/terrain/
  circuit.ts /        # generator branch insertion (up to 16 attempts, else
  circuitGen.ts       #   drop the branch -> seed stays valid):
                      #   pick window [tA,tB] (winLen 90..min(250,0.22L)) on a
                      #   straight-ish mainline section; type shortcut
                      #   (0.60-0.85x, halfWidth 3.5-4.5, radius floor 12.5) or
                      #   scenic (1.2-1.6x, halfWidth 7.5-9, floor 25). Open
                      #   Catmull-Rom, endpoints ON the mainline, interior
                      #   tangent match <=30 deg, elevation endpoint-continuous
                      #   + grade-clamped + above water. BranchSpec on
                      #   CircuitPreset; markers: TrackMarker[] (empty).
  trackGraph.ts       # TrackGraph gains branch edges; closestOnGraph returns
                      #   the true nearest edge (SampleIndex over all edges);
                      #   branchAtSplit(t). TrackEdge.progressAt projects onto
                      #   mainline (wrapLerp tA..tB).
  heightmap.ts        # multi-edge bake: per cell store nearest edge's
                      #   {edgeId,s,halfWidth,t}; pathY = ridge-blended between
                      #   the two nearest distinct edges (RIDGE_BLEND=24 m) so
                      #   junctions blend smoothly. queryPose bilinear picks
                      #   the nearest corner's edge and renormalizes weights
                      #   over same-edge corners (no cross-edge t blend).
src/race/
  routeChoice.ts      # NEW PURE: chooseBranch(info, tuning, rng)->bool.
                      #   p(take) rises with aggression, falls with narrowness;
                      #   scenic inverts. Deterministic per (tuning,rng).
  routeChoice.test.ts
src/core/
  FieldBuilder.ts     # per-rival routePlan: Map<branchId,bool> resolved when a
                      #   split enters the 96 m horizon, cleared after merge;
                      #   sampleAhead + respawnAhead follow the plan. Respawn is
                      #   edge-local: s+5.6 on the same edge, continue past the
                      #   merge node. Humans need no plan (pose is measured).
src/ui/
  Minimap.ts          # MinimapShape { edges: {x,z}[][] }: closed mainline +
                      #   one open polyline per branch (branches thinner/dimmer).
```

## Commits

1. `feat(terrain): branch generation + validation`
   - branch insertion + separation/curvature/elevation/junction validation;
     seed sweep: branches valid or dropped, separation >=26 m outside
     junctions, window <=0.22 L.
2. `feat(terrain): multi-edge field cache + projected progress`
   - multi-edge bake, ridge blend, same-edge bilinear; race tests on a
     synthetic 2-node branch fixture (progressAt monotonic + equal at
     junctions; advanceLap completes; mid-branch->mainline snap < FORWARD_CUT).
3. `feat(race): AI route choice + branch respawn`
   - `routeChoice.ts` + FieldBuilder route plans + edge-local respawn; AI
     drives both routes without stuck spam (manual, multiple seeds).
4. `feat(ui): minimap branches + marker shape`
   - Minimap multi-polyline; `TrackMarker` + `markerWorldPose` helper (empty
     markers); update src/CLAUDE.md 037 subsystem note (separation constants,
     deferred crossings/bridges, projected-t model).

## Risks

- Closest-edge ambiguity corrupting progress (top risk): three mitigations -
  generation-time separation >=26 m (quantified vs carve influence 17 m),
  same-edge bilinear in queryPose, and window cap 0.22<0.34 so even a physical
  cross-route hop is a sector move not a corrupted lap. Race fixture tests pin
  this.
- Junction terrain artifacts (pathY creases where edges meet): endpoints share
  mainline y by construction (tested); ridge blend handles the approach.
- Mid-branch ranking between karts on different routes is approximate:
  acceptable and converges at the merge; documented.
- Minimap legibility with branches: branches drawn dimmer; cosmetic only,
  never race logic.
- Generator can't place a valid branch for some seeds: drop-on-failure keeps
  the track valid (branchless); sweep asserts termination.

## Acceptance

- [ ] Seed sweep: branches valid-or-dropped; separation, window, curvature,
      elevation-continuity, junction-tangent all satisfied; every seed
      terminates valid.
- [ ] Synthetic-branch fixture: projected t monotonic + equal at junctions;
      laps complete on both routes; no false cuts; ranking converges at merge.
- [ ] AI chooses a route deterministically per rival and drives both cleanly.
- [ ] Respawn on a branch lands on-corridor and continues correctly past the
      merge.
- [ ] Minimap shows branches; verify green; files <= 600 lines.

## Depends on

059 (graph + multi-edge-capable cache + width), 056 (AI speed/corridor),
057 (generator + SampleIndex), 058 (CircuitId). Closes 037 v3.
