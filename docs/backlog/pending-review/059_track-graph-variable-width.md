# 059 Track graph + variable road width

Status: open (full plan; ready for execution). Stage 4 of 037 v3.
Folds and retires concept 045.

## Context

Two things must land together because both need a per-station lookup along the
track that does not exist yet:

- Variable width (concept 045): `trackHalfWidth=6` is a literal duplicated
  across 8 files (heightmap, AiDriver, FieldBuilder, KartGrid, propSampler,
  Environment, critters, PropField). A per-circuit, per-station width needs a
  single source that reports `halfWidth(edge, s)`.
- The track graph: 060 adds branches, but the whole race stack assumes one
  closed spline. Introduce the graph data model now, single-edge (mainline
  only), so terrain + width + consumers port to it with zero behavior change,
  and 060 only adds edges.

The unifying primitive is `TrackEdge` with an equal-arc sample table storing
position + halfWidth per station, and a `TrackGraph.closestOnGraph(x,z)` that
returns `{edgeId, s, dist, t, halfWidth, pathY}`. `SplineFieldCache` bakes
those fields per cell; every consumer reads width from the pose instead of a
constant.

## Goal

Road half-width varies 4.5-9 m along a circuit (seed-driven, slope-clamped),
and all 8 consumers respect it. A constant-width single edge reproduces the
pre-change world bit-for-bit (parity gate). The graph model is in place for
060 with no branch behavior yet.

## Non-goals

- Branch generation / multi-edge worlds (-> 060). Graph ships single-edge.
- Racing-line width exploitation by AI (centerline pursuit stays; AI only uses
  width for corridor + caution).

## Architecture (change)

```text
src/terrain/
  trackGraph.ts       # TrackEdge {id, kind, length, tA, tB, pointAt(s),
                      #   tangentAt(s), halfWidthAt(s), curvatureRadiusAt(s),
                      #   progressAt(s)} over an equal-arc table
                      #   (EDGE_SAMPLE_STEP=0.75 m). TrackGraph {main:
                      #   SplineTrack, edges:[edge0], loopLength,
                      #   closestOnGraph(x,z)->GraphPose} - edges[0] wraps the
                      #   mainline; single edge for now. (SampleIndex from 057
                      #   moves/extends here.)
  circuit.ts          # CircuitPreset gains mainWidth: WidthProfile
                      #   {s:number[], halfWidth:number[]} (piecewise-linear).
                      #   generator emits 2-3 low-freq harmonics ->
                      #   halfWidth in [W_MIN=4.5, W_MAX=9], slope-clamped
                      #   |d hw/ds|<=0.03, start zone (t in [0.93,0.03])
                      #   clamped >=6 so the 2-col grid fits.
  heightmap.ts        # FieldSample gains halfWidth; SplineFieldCache bakes
                      #   {dist,pathY,t,edgeId,s,halfWidth} from
                      #   closestOnGraph. heightFromField/colorFromField use
                      #   s.halfWidth instead of cfg.trackHalfWidth. Single
                      #   constant-width edge -> identical output (parity).
  heightSource.ts     # StreamingHeightSource OOB via graph.closestOnGraph
                      #   (same cores -> seamless).
  Terrain.ts          # +graphPose(x,z)->GraphPose (for AI/respawn);
                      #   +corridorClearance(x,z)=dist-halfWidth (for flora).
                      #   closestPose still returns projected t (unchanged
                      #   callers).
src/core/
  FieldBuilder.ts     # corridor half-width from pose (const removed).
src/kart/
  KartGrid.ts         # start-zone lateral clamps to fit halfWidth at t=0.
src/environment/
  propSampler.ts,     # corridor exclusion via Terrain.corridorClearance
  Environment.ts,     #   instead of literal 6 -> flora respects wide roads.
  critters.ts,
  PropField.ts
src/race/
  AiDriver.ts         # already width-aware from 056; now fed real per-station
                      #   halfWidth via the pose/ahead samples.
```

## Commits

1. `feat(terrain): single-edge track graph model`
   - `trackGraph.ts` (`TrackEdge`/`TrackGraph`, mainline only) + tests
     (pointAt spacing, progressAt monotonic, closestOnGraph matches
     SplineTrack.closestPoint).
2. `feat(terrain): per-station width in field cache`
   - `heightmap.ts` fields + parity test (constant width == pre-change).
3. `feat(terrain): variable width generation`
   - `WidthProfile` + generator harmonics + slope/floor clamps; sweep test.
4. `refactor: thread corridor width to all consumers`
   - FieldBuilder/KartGrid/flora via pose/corridorClearance; literals removed.
5. `docs(backlog): retire 045 into 059`
   - delete `concept/045`; note the fold here.

## Risks

- Parity break in the cache refactor: the constant-width bit-parity test is
  the gate; land commit 2 before any width varies.
- Grid spill on narrow start zones: start-zone floor >=6 guarantees the
  2-column grid (lateral 2.0 + kart) fits; test.
- Flora on widened road: corridorClearance switch covers all 4 flora files;
  visual check at a wide-road seed.
- File-size cap: `trackGraph.ts` may approach 600 lines with 060's additions;
  keep SampleIndex + edge tables lean, split if needed.

## Acceptance

- [ ] Constant-width single edge: heightAt/colorAt identical to pre-change on
      a probe grid (parity test).
- [ ] Width varies 4.5-9 m, slope-clamped, start zone >=6 (sweep test).
- [ ] All 8 width consumers read the threaded source; no literal 6 remains for
      corridor width (grep gate).
- [ ] AI holds wide + narrow sections; no stuck spam (manual F3).
- [ ] 045 deleted; verify green; files <= 600 lines.

## Depends on

056 (AI width-aware), 057 (generator + SampleIndex), 058 (CircuitId world).
Folds/retires 045. Feeds 060 (adds branch edges to the graph).

## Implementation notes (review)

- Landed on branch feat/059-060-track-graph-branches together with 060.
- 058 (CircuitId) had not landed; Game still carries the showcase seed.
  The graph/width layer is seed-keyed and slots under CircuitId untouched.
- Parity gate: mainline TrackEdge ALIASES the SplineTrack sample table and
  closed-edge station t = i/n, so the constant-width graph bake is
  bit-identical (test in heightmap.test.ts).
- Consumer threading replaced spline.closestPoint + trackHalfWidth with
  Terrain.corridorClearance in SamplerTerrain (flora/critters), pose
  halfWidth in FieldBuilder/AiDriver, DEFAULT_TRACK_HALF_WIDTH single
  source (trackGraph.ts).
- Added beyond plan (user request): per-biome TrackTraits
  (terrain/trackTraits.ts) — width band/variation + branch chance/bias per
  biome; Game re-derives the circuit per biome (same mainline shape, biome
  width + forks). Desert wide/scenic, alpine narrow/shortcut, tundra calm,
  tropical twisty/fork-heavy; temperate = defaults (parity).
- 045 was already retired by the concept renumber; nothing to delete.
