---
type: Subsystem
title: Circuit Branches and Width
description: >
  Procedural branch (split/rejoin) generation + validation and the variable
  road width profile.
tags: [terrain, circuit, branch, width, procedural]
timestamp: 2026-07-07T00:00:00Z
---

# Schema

`src/terrain/circuitBranch.ts` emits up to two open alternative paths
(branches) between two mainline params, validated so the single-`t` race
model stays unambiguous. `src/terrain/circuitWidth.ts` swings the mainline
half-width across the biome band. Both are pure + deterministic in
(seed, control/length, traits); jsdom-safe, no three/WebGL. Branch specs
are consumed by the `TrackGraph` (`src/terrain/trackGraph.ts`) as branch
`TrackEdge`s.

## BranchSpec

`generateBranches` returns `BranchSpec[]`:

| Field       | Meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| `kind`      | `"shortcut"` or `"scenic"`                                   |
| `tA`, `tB`  | Mainline params of the split/merge anchors (branch tA -> tB) |
| `points`    | Dense sampled centerline (~2 m), endpoints ON the mainline   |
| `halfWidth` | Constant corridor half-width for the branch (m)              |

## Constructions

`buildBranch` builds one candidate per kind + window:

| Kind     | Geometry                                              | halfWidth | Radius floor |
| -------- | ----------------------------------------------------- | --------- | ------------ |
| shortcut | Cubic Hermite A -> B; end tangents = mainline tangent | 3.5-4.5   | 12.5         |
| scenic   | Window centerline offset outward (rise-plateau-fall)  | 7.5-9     | 25           |

Shortcut: the lateral gap comes from the window curving away, so a
pre-check demands `chord >= 30`, `arc/chord in [1.08, 2.0]`, and junction
tangent/chord alignment under 40 deg — only a curved window can be cut.

Scenic: the window itself must be straight-ish (`windowMinRadius >= 45`,
`winLen >= 170`) so the outward offset does not fight mainline curvature.
Bow depth (28-60 m) adapts to the ramp length (`SCENIC_BOW_RADIUS = 34`);
outward = right of travel on a CCW loop.

## Validation

`branchRejectReason(m, index, spec, others)` returns a reason string or
null. Checks, in order:

- `too-few-points` (< 8), window bounds (`tA >= 0.08`, `tB <= 0.92`),
  span cap (`<= 0.22` lap, below checkpoints' `FORWARD_CUT = 0.34`)
- endpoints sit on the mainline (within 1.5 m)
- junction tangent match under 30 deg (`BRANCH_TANGENT_MAX`)
- curvature floor (kind-specific) + length/window-arc ratio band
  (shortcut `[0.5, 0.95]`, scenic `[1.04, 1.7]`)
- grade cap `|dy/ds| <= 0.2` (`BRANCH_GRADE_MAX`)
- separation: every point `>= SEP_MIN_BRANCH (26)` from the mainline
  outside the junction ramps; inside a ramp (`RAMP_FRACTION = 0.38` each
  end) the nearest mainline point must sit in the branch's OWN window
  (`foreign-approach` rejects a foreign section threading a mouth)
- plateau coverage `>= PLATEAU_MIN_COVER (0.15)` of points at full
  separation; branches are mutually `SEP_MIN_BRANCH` apart (windows kept
  disjoint via `WINDOW_GAP = 0.04`)

## Window Scan

`scanForBranch` steps `tA` around the lap (rng phase so seeds vary),
longest windows and biome-preferred kind first; the first candidate that
passes full validation wins. Scanning (not random draws) matters: valid
windows are sparse, so a fixed draw budget misses them on most seeds.
`MAX_VALIDATIONS (60)` caps the expensive full-validation calls. A loop
without a qualifying window ships branchless — drop, never a hard failure.

## Deferred by Invariant

Same-level crossroads (one (x,z) -> one `t`) and bridges (`heightAt` is
single-valued) are unreachable by construction; the separation + window
rules keep one (x,z) -> one `t` on the road. Route walking + AI choice
live in `src/race/routing.ts` + `src/race/routeChoice.ts`.

## Width Profile

`generateWidthProfile(seed, length, traits, curv?)` builds the per-station
half-width for the closed mainline:

- `count = max(8, round(length / 10))` stations, `step = length / count`
- 2-3 harmonics (50% chance of a 3rd), integer cycle counts `k in [1,3]`
  -> seam-continuous on the closed loop, `1/(h+1)` falloff so the lowest
  frequency dominates (broad swells, not jitter), random phase
- without curvature (legacy/back-compat path):
  `hw[i] = clamp(mid + amp*v/norm, widthMin, widthMax)` with
  `mid = (widthMin+widthMax)/2`,
  `amp = widthVariation*(widthMax-widthMin)/2`

When `curv` (a `CurvatureSeries {ds, kappa}` from `centerlineCurvature` in
`src/terrain/circuit.ts` — signed turn rate of the ACCEPTED centerline) is
supplied, corner choreography replaces most of the harmonic swing:

- corner intensity = `smoothstep(1/60, 1/24, |kappa|)` after ~9 m box
  smoothing (ramps in from radius 60 m, saturates at 24 m)
- entry = max intensity over a 12-55 m lookahead window
- `shape = 0.9*entry*(1 - intensity) - intensity` -> wide approach,
  pinch at the apex, relax on straights
- `hw[i] = clamp(mid + amp*(0.45*v/norm + shape), widthMin, widthMax)` —
  harmonics drop to low-weight texture
- start straight: the start zone plus the first 40 m past the line is
  raised toward `min(widthMax, START_MIN_HALF_WIDTH + 2)` so the field
  launches onto a broad straight

Three invariants are then enforced (both paths):

- band clamp: `widthMin <= hw <= widthMax` everywhere
- start-zone floor: `t in [0.93, 1) u [0, 0.03]` raises `hw >= 6`
  (`START_MIN_HALF_WIDTH`); the 2-column start grid (lateral 2.0
  straddle) always fits
- slope clamp: `|d hw / d s| <= WIDTH_SLOPE_MAX (0.045)` via raise-only
  relaxation (`relaxSlope`, up to 64 passes). Raising preserves both
  floors; values stay bounded by the band max because a raise never
  exceeds its neighbor.

Deterministic in (seed, length, traits, curv). The harmonic draw is
seed-only; the choreography follows whichever attempt the accept gate
chose, so a taming retry re-choreographs to the new geometry.
`inStartZone(t)` is the exported start-zone test.

# Citations

- [Circuits](/terrain/circuits.md) — `generateCircuit` + `buildMainline`
- [Circuit Shape](/terrain/circuit-shape.md) — 2D loop primitives
- [SplineTrack](/terrain/spline-track.md) — mainline sample source
