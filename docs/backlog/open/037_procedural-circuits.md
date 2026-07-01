# 037 Procedural circuits

Status: open (full plan; ready for execution)

## Context

`SplineTrack` (`src/terrain/SplineTrack.ts:48`) is already config-driven: it
consumes `TerrainOptions.control` (`src/terrain/Terrain.ts:23-24`) — an array of
world-metre `[x,y,z]` tuples — and builds a closed centripetal Catmull-Rom loop
(`SplineTrack.ts:61`), start/finish = `t=0`. The plug-in contract is tiny: any
array of tuples feeds straight through `new Terrain({control, worldSize})` ->
`new SplineTrack(control)`. The gap is purely upstream: the only circuit that
exists is the hardcoded `DEFAULT_CONTROL` (`SplineTrack.ts:23-36`, 12 pts, ~62 m
radius, ~377 m loop), and `Game.buildWorld` (`src/core/Game.ts:148-153`) never
forwards a `control` value.

Everything downstream of the spline derives from the arc-length param `t`, not
from geometry, so it works unchanged on a generated loop **provided the loop
stays drivable**:

- Checkpoints (`src/race/checkpoints.ts`) are uniform `t`-sectors
  (`buildSectorBoundaries`, `:51`); lap validity is cut-proof and
  geometry-agnostic.
- AI racing line (`src/race/AiDriver.ts`) is pure-pursuit over spline `ahead`
  points (`FieldBuilder.sampleAhead`, `src/core/FieldBuilder.ts:457`); the
  spline centerline IS the line.
- Grid (`src/kart/KartGrid.ts`) + respawn (`FieldBuilder.respawnAhead`) derive
  from `t`.

So "procedural circuit" reduces to two problems: (1) a pure
`generateCircuit(seed, opts)` that emits drivable, non-self-intersecting
control points; (2) wiring one selection through `Game` -> `Terrain`. This plan
owns both end-to-end and **retires 020** (its track-select half +
`CircuitPreset` notion are absorbed here; 020's kart-select half already
shipped in 024).

The drivability floor is **speed-dependent**, not a bicycle model.
`KartController.applySteering` (`src/kart/KartController.ts:311-323`) sets yaw
rate directly, so:

```text
R_min(v) = v / (maxSteerRate * (1 - topSpeedSteerFactor * v/maxSpeed))
DEFAULT_TUNING (KartController.ts:29-48): maxSpeed 34, maxSteerRate 2.6,
  topSpeedSteerFactor 0.55.
```

Floors: 34 m/s -> 29 m (Speedster at 39 -> 40.6 m); 21 m/s -> 12.5 m, which is
exactly AiDriver's `SHARP_TURN = 0.32 rad/4m` (`AiDriver.ts:30`) lift-off
threshold (`R = 4/0.32 = 12.5 m`); <7 m/s -> ~3 m (drift-off). AI has **no
max-curvature clamp** — it only eases throttle to 0.45 (`AiDriver.ts:158-176`)
and falls back to stuck-respawn (`CORRIDOR_HALF_WIDTH=6`, `stuckTime=2s`),
which is a safety net, not clean driving. The generator must therefore
guarantee the radius floor itself.

Determinism infra is ready: `makeRNG` + `hashSeed` (`src/core/rng.ts:58,77`),
with the established sub-seed idiom `(seed ^ hashSeed("circuit")) >>> 0`.

## Scope

Add a pure seeded circuit generator (`generateCircuit`) with difficulty
presets + elevation (pathY), validate every output drivable-by-construction +
simple (no self-intersection), wire a circuit selection through
`Game.rebuildWorld` -> `Terrain`, expose a circuit picker in the start menu,
and persist the choice.

Not in scope (-> new concept stubs 044/045, created during execution):

- A circuit-options panel (per-knob difficulty/elevation cycle rows, free
  seed-text entry, randomize). v1 bundles these into named presets.
- Variable road width. `trackHalfWidth=6` is duplicated as a literal across 8
  source files (heightmap, AiDriver, FieldBuilder, KartGrid, propSampler,
  Environment, critters, PropField). v1 keeps width fixed at 6 so all stay
  correct; varying it needs the consolidation first.
- Biome-aware circuit bias (an alpine biome auto-biasing elevation). v1 keeps
  circuit + biome as independent select dimensions that compose.
- Rebuilding `Environment`'s sky/time (orthogonal; composes via rebuildWorld).

## Goal

A player opens the menu, picks a circuit (named presets or RANDOM), the world
rebuilds to that seeded loop, and the race runs on a fresh, drivable, non-
repeating track that composes with the chosen biome. Same seed -> same
circuit, every time. Default selection is bit-identical to today's circuit.

## Non-goals

- Change `SplineTrack`, `Terrain`, checkpoints, AI, grid, or respawn
  contracts. 037 only produces `control` + `worldSize` and retunes two
  loop-length-coupled constants in `FieldBuilder`.
- Vary `trackHalfWidth` (fixed 6 in v1; -> 045).
- Hand-author multiple circuits; generation is the source of >1 circuit.
- Add a new select state (circuit is a start-menu row, like biome).

## Architecture (change)

```text
src/terrain/
  circuit.ts            # NEW PURE: Difficulty, Elevation, CircuitOptions,
                        #   CircuitPreset {control; worldSize}, DIFFICULTY_-
                        #   PRESETS {easy/medium/hard -> minRadius + knobs},
                        #   CIRCUIT_PRESETS (named seeds incl. PARITY),
                        #   PARITY_CIRCUIT (= DEFAULT_CONTROL, worldSize 200).
                        #   generateCircuit(seed, opts)->CircuitPreset:
                        #     polar-monotone control points (theta_i mono-
                        #     tonic, bounded r(theta), y(theta) elevation),
                        #     then validateCircuit builds the SAME curve
                        #     SplineTrack uses (new CatmullRomCurve3(pts,
                        #     true,"centripetal"), three-math only, no GL) to
                        #     sample min radius + self-intersection; on a
                        #     floor breach re-rolls a deterministic sub-seed,
                        #     capped, PARITY fallback. jsdom-testable.
  circuit.test.ts       # determinism; closed loop; minRadius>=floor per
                        #   difficulty; no self-intersection; all ctrl pts
                        #   within +-worldSize/2; re-roll determinism +
                        #   always-valid within cap over N seeds; elevation
                        #   grade clamp; PARITY==DEFAULT_CONTROL.
  SplineTrack.ts        # UNCHANGED (consumes opts.control; DEFAULT_CONTROL
                        #   stays as fallback).
  Terrain.ts            # UNCHANGED (already forwards opts.control +
                        #   worldSize).
src/core/
  FieldBuilder.ts       # AI_AHEAD_STEP + RESPAWN_AHEAD_T -> loop-length-
                        #   aware: AI_AHEAD_STEP_METERS=3,
                        #   RESPAWN_AHEAD_METERS~5.6, t-step = meters /
                        #   spline.curve.getLength(), computed+cached in
                        #   build(). Lookahead window stays ~48 m regardless
                        #   of loop length. trackHalfWidth 6.
  Game.ts               # buildWorld(biome, circuit?) forwards circuit.control
                        #   + worldSize into TerrainOptions (control via ctor;
                        #   worldSize override). rebuildWorld(biome, circuit?)
                        #   threads circuit (rebuilds terrain+env+field; env
                        #   refloraes because props read heightAt).
                        #   currentCircuit field; onStart grows to (mode,
                        #   biome, circuit) and rebuilds when biome OR circuit
                        #   changed. Default = PARITY_CIRCUIT (bit-identical
                        #   first load).
  Game.test.ts          # rebuild on circuit change restores body count over
                        #   3 switches; PARITY bit-identical when unset.
  circuitStorage.ts     # NEW localStorage gamecart.circuit.v1; mirrors
                        #   kartSelectionStorage (try/catch, fallback, no
                        #   throw).
  circuitStorage.test.ts
src/ui/
  StartMenu.ts          # circuit row mirroring the biome row: one button per
                        #   CIRCUIT_PRESETS entry + RANDOM (fresh seed,
                        #   medium). selectedCircuit getter;
                        #   refreshCircuitHighlight; onStart grows to (mode,
                        #   biome, circuit). MenuNav elements() includes
                        #   circuit buttons.
  StartMenu.test.ts     # circuit pick carried into onStart; nav reaches row.
```

## Algorithm (polar monotone + validate)

```text
rng = makeRNG((seed ^ hashSeed("circuit")) >>> 0)
preset = DIFFICULTY_PRESETS[opts.difficulty ?? "medium"]
N points, theta_i = i/N * 2pi            # monotone angle -> star-shaped loop
r_i  = baseR * (1 + sum_k a_k sin(f_k theta + phi_k))   # bounded low-freq,
                                           # cornerDensity ~ f_k, ~ a_k
y_i  = elevationProfile(opts.elevation, theta)          # flat/rolling/alpine,
                                           # grade-clamped |dy/ds| <= maxGrade
control = [(r_i cos theta_i, y_i, r_i sin theta_i)]
validate -> sample CatmullRomCurve3(control, true, "centripetal"):
  minR = min over samples of 1/curvature ; reject if minR < preset.minRadius
  self-intersect = any non-adjacent segment pair crosses ; reject if true
on reject -> re-roll sub-seed (seed ^ hashSeed("circuit"+attempt)),
  regenerate, capped at MAX_ATTEMPTS; if exhausted, return PARITY_CIRCUIT
  (never throws).
worldSize = 2 * (maxR + MARGIN)           # MARGIN ~ trackHalfWidth+blend+buf
```

Star-shaped (monotone angle, bounded radius) makes self-intersection rare by
construction; the validator is the hard guarantee. The validator uses the
exact curve type `SplineTrack` uses, so the measured radius matches the real
road.

## Curvature floors (data)

```text
R_min(v) = v / (2.6 * (1 - 0.55*v/34))        # DEFAULT_TUNING
DIFFICULTY_PRESETS:
  easy   minRadius 30   (clean to ~34 m/s cruising)
  medium minRadius 18   (clean to ~27 m/s)
  hard   minRadius 12.5 (= AiDriver SHARP_TURN threshold; clean to ~21 m/s)
PARITY_CIRCUIT = { control: DEFAULT_CONTROL, worldSize: 200 }  # today's loop
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(terrain): procedural circuit generator + presets`
   - `circuit.ts` + `circuit.test.ts` (pure; three-math only). Floors as
     above; PARITY == `DEFAULT_CONTROL`. Tests: determinism, closed loop, min
     radius per difficulty, no self-intersection, worldSize fit, re-roll
     determinism + always-valid over 200 seeds, grade clamp.
2. `refactor(core): loop-length-aware field AI/respawn sampling`
   - `FieldBuilder.ts` `AI_AHEAD_STEP`/`RESPAWN_AHEAD_T` -> metres/length
     (cached in `build()`). Test: default loop reproduces today's ~0.008 step;
     a 2x loop halves the t-step (constant ~3 m / ~5.6 m lookahead).
3. `feat(core): circuit storage + Game world-rebuild wiring`
   - `circuitStorage.ts` (+test); `Game.buildWorld`/`rebuildWorld`/`onStart`
     thread circuit; `Game.test` parity + body-count-over-switches.
4. `feat(ui): circuit picker in start menu`
   - `StartMenu.ts` circuit row + `selectedCircuit` + `onStart(mode, biome,
circuit)`; MenuNav reaches it; `StartMenu.test`. Closes the feature.
5. `docs: refine 037, retire 020, stub 044/045, troubleshooting`
   - move 037 concept -> open (this plan); mark 020 retired/subsumed; create
     `concept/044_circuit-options-panel.md` + `concept/045_variable-road-
width.md`; troubleshooting case (F3: drive a generated circuit; body
     count after a circuit switch; AI on-corridor on hard; min-radius
     readout).

## Risks

- Validator-vs-road drift: measured radius must match the real road.
  Mitigated: validator builds the identical `CatmullRomCurve3(pts, true,
"centripetal")`; integration test builds a real `SplineTrack` from a
  generated preset and asserts min radius >= floor on the actual spline.
- Re-roll non-termination: capped attempts + PARITY fallback; assert over 200
  seeds every output is valid within cap and PARITY is never hit for
  documented presets.
- worldSize miss: a loop larger than the cache falls back to O(n)
  `closestPoint` (`StreamingHeightSource`). Mitigated: generator sets
  `worldSize = 2*(maxR+MARGIN)`; test all control pts within +-worldSize/2.
- Loop-length coupling: `AI_AHEAD_STEP=0.008` was hand-tuned to the 377 m
  loop. Mitigated: commit 2 makes it metres/length so the ~48 m lookahead
  window is constant for any loop.
- `trackHalfWidth` 8-file duplication: v1 keeps it 6 everywhere -> no
  correctness change; documented, variable width -> 045.
- Biome x circuit both rebuild the world: `rebuildWorld(biome, circuit)`
  rebuilds all three on either change; deterministic, so a same-biome circuit
  switch just refloraes. Test body count returns to baseline.
- Menu parity: default selection = PARITY -> first load bit-identical. Test.

## Acceptance

- [ ] `generateCircuit` deterministic; every output a closed loop with min
      radius >= floor(difficulty) and no self-intersection; PARITY fallback
      never needed for named presets.
- [ ] Floors match kart physics: easy >=30 m, medium >=18 m, hard >=12.5 m
      (R=v/omega derivation in plan); AI stays on-corridor on a hard circuit
      (no stuck-respawn spam).
- [ ] worldSize fits the loop; `AI_AHEAD_STEP`/`RESPAWN_AHEAD_T` scale with
      loop length (default loop reproduces ~0.008).
- [ ] Menu circuit picker selects + carries into `onStart(mode, biome,
circuit)`; MenuNav + gamepad reach it; default = PARITY (bit-identical).
- [ ] Circuit switch rebuilds terrain+env+field; body count returns to
      baseline over 3 switches; never mid-race.
- [ ] Choice persists (`gamecart.circuit.v1`).
- [ ] All touched files <=600 lines; `typecheck && lint && test` + hook green.

## Defaults

- difficulty medium; elevation rolling; baseR ~60 m; worldSize ~200 (scales
  with maxR); trackHalfWidth 6 (fixed v1).
- Menu default = PARITY (current `DEFAULT_CONTROL` circuit).
- DIFFICULTY_PRESETS: easy{30,low,low}, medium{18,mid,mid}, hard{12.5,high,
  dense}.
- CIRCUIT_PRESETS: PARITY + a few fixed-seed showcase circuits (incl. one
  alpine-elevation) + RANDOM (fresh seed, medium).

## Verification

- Cycle PARITY/easy/medium/hard/RANDOM in the menu; F3-drive each.
- Hard circuit: AI lifts into corners and stays within corridor (no respawn
  spam); min-radius readout >= 12.5 m.
- Reload after picking a showcase circuit -> same circuit restored.
- `npm run verify:changed` then `npm run verify`.

## Depends on

003 (SplineTrack + `TerrainOptions.control` contract). 007 (AI/checkpoints -
drivability target, no change). 025 (biome composes; circuit + biome = track,
both select dims via `rebuildWorld`). Uses `src/core/rng.ts`. **Retires 020**
(track-select + `CircuitPreset` absorbed here; 020's kart-select half shipped
in 024). Independent of 004-006/010/023/038/042; composes with 038/042
(sky/time are orthogonal select dims). Deferred knobs -> 044 (options panel) +
045 (variable road width).
