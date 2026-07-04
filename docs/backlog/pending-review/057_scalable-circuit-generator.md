# 057 Scalable circuit generator (600-1500 m)

Status: pending-review. Stage 2 of 037 v3. Implemented on
feat/057-interesting-circuits (supersedes the first cut on
feat/057-scalable-circuit-generator, PR 75, whose shapes stayed oval);
all automated gates green, incl. shape-quality distribution floors.
Manual F3 bake/framing check at a max-size seed still open.

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
  circuitShape.ts     # NEW PURE: 2D loop primitives - convex hull, tangent-
                      #   arc corner fillets (drawn radius mix hard 16-24 /
                      #   medium 26-42 / sweeper 46-75, capped by arm), spike
                      #   drop, subdivision, min-edge, signed midpoint
                      #   displacement, two-tier push-apart relax, Laplacian
                      #   smoothing, curve length.
  circuitGen.ts       # NEW PURE: buildMainline(rng) -> {control, worldSize}.
                      #   1. L = rng.range(600,1500); draw fold/chicane
                      #      counts; skeleton perimeter = alpha*L where alpha
                      #      budgets the length features add.
                      #   2. INTERIOR scatter in rotated ellipse -> hull
                      #      (5-9 genuine corners; boundary scatter = ovals).
                      #   3. fillet every corner with a sampled tangent arc
                      #      (radius pinned by construction, not by luck).
                      #   4. carve features into remaining straights:
                      #      keyhole hairpin bays (90-deg mouth fillets,
                      #      parallel legs, exact semicircle apex 17-25 m,
                      #      depth capped by a 3-ray clearance fan) and
                      #      chicanes (+w/-w S-flicks).
                      #   5. subdivide -> displace x2 -> length normalize ->
                      #      smooth -> two-tier relax -> exact length trim.
                      #   6. elevation profile + coherence pass (XZ-near,
                      #      arc-far pairs converge so hairpin legs stay
                      #      level with each other).
  circuitGen.test.ts  # 5000-seed sweep: valid (radius>=12.5, no self-
                      #   intersect, tiered separation), length 588-1530,
                      #   worldSize<=768, determinism, extent - PLUS shape
                      #   floors: >=85% hairpin, >=50% 2+ esses, >=65% 6+
                      #   corners, >=70% 60 m straight (anti-oval guard).
  circuit.ts          # generateCircuit(seed): attempt loop (12) with taming
                      #   (feature scale/displacement/elongation shrink,
                      #   smoothing rises); accept needs valid AND
                      #   interesting (hairpin | 2 esses | 7 corners) for
                      #   attempts 0-7, valid-only after; FALLBACK_SEED draw
                      #   (test-asserted valid) guarantees termination.
                      #   validateCircuit -> CircuitAnalysis: Menger radius,
                      #   tiered separation (arc gap 60-140 m -> >=18 m legs;
                      #   >140 m -> >=30 m), bucket-accelerated self-
                      #   intersection, corner metrics (hairpins/esses/
                      #   straights).
  trackGraph.ts       # SampleIndex - uniform XZ bucket grid (16 m):
                      #   nearestSample(x,z) expanding ring (exact parity
                      #   with linear scan) + forEachWithin radius query.
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

Why the redesign of the plan's pipeline: hull + midpoint displacement alone
trends to convex blobs (S-bends only by luck), and a bare Catmull-Rom
through a sharp hull corner kinks far below the 12.5 m radius floor - the
first cut "fixed" that by scattering on the ellipse boundary, which is the
polar-oval failure again. The corner-vocabulary construction (fillet arcs +
keyhole bays) pins every turn radius explicitly, so validity AND variety
hold by construction, enforced by the sweep's shape floors.

Why tiered min-separation (not flat 30 m): hairpin legs are near in arc
(60-140 m), share elevation via the coherence pass, and legitimately sit
20-46 m apart; only far-in-arc sections (>140 m) tear the field cache and
need the full corridor+blend footprint (>=30 m). A flat 30 m floor at
arc gap >60 would veto every genuine hairpin.

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

- [x] 5000-seed sweep: all valid, length 600-1500 m +-2%, worldSize<=768,
      deterministic.
- [x] Single-loop field-cache output bit-identical pre/post SampleIndex.
- [ ] Bake < ~1.5 s at max world size; no terrain seams/normal artifacts
      (manual F3 at a 1500 m seed).
- [x] Touched files <= 600 lines; verify green.

## Depends on

056 (AI must handle long/irregular loops first). 003 (terrain contract).
Feeds 058 (UI selects these seeds), 059 (multi-edge cache + width),
060 (branch generation extends this).
