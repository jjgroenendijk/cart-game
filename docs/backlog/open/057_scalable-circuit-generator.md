# 057 Scalable circuit generator (600-1500 m)

Status: open (full plan; ready for execution). Stage 2 of 037 v3.

## Context

The rejected generators built control points polar around the origin:
`r(theta) = baseR * (1 + harmonics)` with monotonic `theta`. A single-valued
`r(theta)` around one center can only make star/oval shapes - no S-bends, no
inward folds, no long point-to-point feel - and `BASE_RADIUS=60` caps extent,
so loops stayed ~380 m. The review wants 600-1500 m seed-varied circuits with
genuine shape variety.

Replace the construction with the standard seeded racetrack pipeline (scatter
-> convex hull -> midpoint displacement -> relaxation -> length normalize),
which scales to any target length and yields kidney/S/peanut shapes. Keep the
proven parts: the Menger-curvature + self-intersection validator built on the
exact `CatmullRomCurve3(pts, true, "centripetal")` the road uses, the attempt
loop with progressive relaxation, and a seed-independent fallback so every
seed terminates valid.

Longer worlds stress the terrain bake: `SplineFieldCache` currently brute-
forces `track.closestPoint` (O(1024) scan) per grid cell; at a 768 m world
that is multi-second. A bucket-grid `SampleIndex` over the spline samples
makes bake sublinear and is reused later by 059/060 for multi-edge queries.

This stage wires the new generator at a fixed default seed (still single loop,
constant width 6, no UI) so it lands green and drivable before the graph
(059), width (059), codes (058), and branches (060).

## Goal

`generateCircuit(seed)` emits a drivable, non-self-intersecting single loop of
seed-varied length 600-1500 m with real shape variety, fitting a world of
`worldSize <= 768` m, valid over a 5000-seed sweep. Terrain bake stays under
~1.5 s at max world size.

## Non-goals

- Variable width (-> 059), branches (-> 060), codes/UI (-> 058). Width stays 6.
- Biome selection change (-> 058); this stage keeps whatever seed->biome the
  code currently uses for the default, no new registry yet.

## Architecture (change)

```text
src/terrain/
  circuitGen.ts       # NEW PURE: buildMainline(rng) ->
                      #   { control, worldSize }.
                      #   1. L = rng.range(600,1500).
                      #   2. scatter M=18..30 pts in an ellipse
                      #      (semi-axes from L/2pi, elongation +-0.3).
                      #   3. convex hull (Andrew monotone chain).
                      #   4. midpoint displacement x2 (normal offset
                      #      DISP_AMP=0.05..0.13 of perimeter, halved/round).
                      #   5. push-apart relaxation (4 iters): ctrl pairs with
                      #      index gap>=3 and dist<CTRL_SEP=45 pushed apart.
                      #   6. length-normalize: build centripetal curve,
                      #      scale XZ by L/getLength(), re-validate.
                      #   7. elevationProfile (reused) scaled with L.
  circuitGen.test.ts  # 5000-seed sweep: valid (radius>=12.5, no self-
                      #   intersect, min-separation), length in [600,1500]
                      #   +-2%, worldSize<=768, determinism (same seed ->
                      #   deep-equal), extent within +-worldSize/2.
  circuit.ts          # generateCircuit delegates to circuitGen; keeps the
                      #   attempt loop + progressive relaxation on DISP_AMP/
                      #   elongation + seed-independent fallback; adds min-
                      #   separation validation: any sample pair with arc gap
                      #   >60 m must be >= SEP_MIN=30 m apart in XZ (bucket-
                      #   accelerated). Extent cap: shrink+retry if bbox >
                      #   768-2*MARGIN. MARGIN=30.
  trackGraph.ts       # NEW: SampleIndex - uniform XZ bucket grid (16 m) over
                      #   spline samples; nearestSample(x,z) via expanding
                      #   ring. (Full graph types arrive in 059; this file
                      #   starts with just the index.)
  heightmap.ts        # SplineFieldCache bake uses SampleIndex instead of the
                      #   O(N) scan. Output identical for a single loop
                      #   (parity test).
  Terrain.ts /        # worldSize-scaled budgets: heightTexels =
  TerrainChunkManager #   clamp(pow2ish(worldSize*1.4),384,1024); gridCount =
                      #   clamp(round(worldSize/48),8,16).
src/core/
  Game.ts             # default world uses a fixed showcase seed via the new
                      #   generator (temporary until 058's UI). No signature
                      #   change yet.
```

Why min-separation now (before branches): two centerlines closer than
`halfWidth + blendWidth` (<= 17 m at max width) let the field cache snap a
cell ambiguously between distant sections, tearing the road surface. 30 m
gives margin and pre-empts the same failure the branch validator needs.

## Commits

1. `feat(terrain): sample index for spline field bake`
   - `SampleIndex` + `SplineFieldCache` uses it; single-loop parity test.
2. `feat(terrain): hull-displacement circuit generator`
   - `circuitGen.ts` behind delegation; 5000-seed validity + length sweep.
3. `feat(terrain): scale terrain budgets to world size`
   - heightTexels/gridCount scaling; verify no seam/normal regressions.
4. `feat(core): default world uses scalable generator`
   - fixed showcase seed; F3 drive; bake-time check at max world size.

## Risks

- Generator convergence (some seeds can't hit radius+separation+length):
  progressive relaxation + seed-independent fallback guarantee termination;
  the 5000-seed sweep is the gate.
- Bake time at 768 m: `SampleIndex` is mandatory (commit 1 lands first);
  fallback knob: cache cell 2->3 m for worldSize>600.
- Menu-cam / minimap framing tuned to ~200 m worlds: retune framing to
  `worldSize`; minimap already rescales via `refresh(halfExtent)`.
- Chunk density at gridCount 8 over 768 m (96 m chunks): bump gridCount as
  specified; verify LOD/streaming still smooth (F3).

## Acceptance

- [ ] 5000-seed sweep: all valid, length 600-1500 m +-2%, worldSize<=768,
      deterministic.
- [ ] Single-loop field-cache output bit-identical pre/post SampleIndex.
- [ ] Bake < ~1.5 s at max world size; no terrain seams/normal artifacts
      (manual F3 at a 1500 m seed).
- [ ] Touched files <= 600 lines; verify green.

## Depends on

056 (AI must handle long/irregular loops first). 003 (terrain contract).
Feeds 058 (UI selects these seeds), 059 (multi-edge cache + width),
060 (branch generation extends this).
