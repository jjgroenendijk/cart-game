# 056 AI competence on arbitrary loops

Status: pending-review (code complete; manual in-game lap-time gate
pending). Stage 1 of 037 v3.

## Context

Two defects cap AI quality at "tuned for the one near-round default loop",
and both get worse the longer/more irregular tracks become (057 makes them
600-1500 m):

- Arc-length bug: `FieldBuilder.sampleAhead` (`src/core/FieldBuilder.ts`)
  steps `spline.curve.getPoint(t + k*aiAheadStepT)` with `aiAheadStepT =
AI_AHEAD_METERS / loopLength`. `CatmullRomCurve3.getPoint` is not
  arc-length parameterized, so the intended 3 m sample spacing stretches and
  compresses around the loop. `SplineTrack` already owns the fix: its
  `closestPoint` sample table (`src/terrain/SplineTrack.ts:64`) is built from
  `getSpacedPoints` - arc-length-even - it just has no public accessor.
- Speed model: `AiDriver.curvatureThrottle` (`src/race/AiDriver.ts`)
  estimates a single turn angle from 3 points at 0/33/66% of the ahead
  window and eases throttle toward 0.45. No braking distance, no notion of
  how sharp the corner actually is in radius terms, blind past the window.
  Works on gentle ovals; on a long straight into a hairpin the AI arrives
  hot and relies on the stuck-respawn safety net.

Also groundwork for 059: the corridor half-width literal 6 is read
independently by `AiDriver` (`CORRIDOR_HALF_WIDTH`) and `FieldBuilder`; both
must become per-sample inputs before width can vary.

`AiDriver` is pure/dependency-free (jsdom-testable) and must stay so.

## Goal

AI drives any drivable closed loop (min radius >= 12.5 m) competently:
brakes before corners proportional to their radius, holds the corridor, no
stuck-respawn spam. Measurable gate: on today's default track, AI lap times
within +-10% of current behavior after retune.

## Non-goals

- No racing-line offset/apex cutting (centerline pursuit stays).
- No difficulty knob (-> 061). No drift usage (documented non-goal of 007).
- No track/generator changes (-> 057).

## Architecture (change)

```text
src/terrain/
  SplineTrack.ts      # +pointAtArc(meters, out): position from the existing
                      #   equal-arc table (index = meters/length * N, lerp
                      #   between samples, wrap). No new precompute.
src/race/
  aiSpeed.ts          # NEW PURE: allowedSpeed(ahead, tuning) -> m/s.
                      #   Per-triple Menger radius R_i over the ahead
                      #   samples; corner speed v_i = sqrt(A_LAT * R_i);
                      #   brake-limited vAllow = min_i sqrt(v_i^2 +
                      #   2*A_BRAKE*d_i) with d_i = arc distance to sample i.
                      #   A_LAT scaled by aggression and by
                      #   clamp01(halfWidth/6)^0.5 (narrow -> cautious).
  aiSpeed.test.ts
  AiDriver.ts         # AiSplinePoint gains halfWidth; AiPose gains
                      #   corridorHalfWidth. curvatureThrottle removed;
                      #   throttle = full below allowedSpeed, ease/zero
                      #   above. Stuck test uses pose.corridorHalfWidth
                      #   (CORRIDOR_HALF_WIDTH const dies here).
src/core/
  FieldBuilder.ts     # sampleAhead walks pointAtArc(s0 + k*4) for
                      #   AI_AHEAD_SAMPLES=24 (96 m horizon); aiAheadStepT
                      #   dies. Fills halfWidth=6 (constant until 059).
                      #   Corridor test reads the same constant via the pose.
```

Constants: `AI_AHEAD_SAMPLES=24` @ 4 m spacing, `A_LAT_BASE=10` m/s^2
(scaled `0.85 + 0.3*aggression`), `A_BRAKE=8` m/s^2. Tune against
`KartController` grip/decel on the default track; the +-10% lap-time gate is
the check that the model matches the physics.

## Commits

1. `feat(terrain): arc-length point accessor on SplineTrack`
   - `pointAtArc` + tests (spacing error < 2% on an eccentric test loop).
2. `refactor(core): metre-true AI lookahead sampling`
   - `sampleAhead` via `pointAtArc`; regression test: sample spacing 4 m
     +-5% on an eccentric loop (fails on the old getPoint path).
3. `feat(race): braking-distance AI speed model`
   - `aiSpeed.ts` + swap into `AiDriver.produceInput`; retune; lap-time
     gate on default track.
4. `refactor(race): width-aware corridor plumbing`
   - `halfWidth`/`corridorHalfWidth` fields threaded, value still 6;
     `CORRIDOR_HALF_WIDTH` consts removed from AiDriver + FieldBuilder.

## Risks

- Speed-model mismatch with kart physics (understeers out or crawls):
  mitigated by the lap-time envelope gate + keeping tuning bands in
  `aiTuning.ts` untouched.
- Rubber-band interaction: `withSpeedScale` multiplies `maxSpeedScale`, and
  allowedSpeed is a separate cap - verify trailing rivals still catch up
  (rubber-band raises the cruise cap, not corner speeds; that is correct).

## Acceptance

- [x] Sample spacing metre-true (test). `aiAheadStepT` gone.
- [x] Hairpin-ahead produces lower allowedSpeed than straight-ahead;
      narrower halfWidth lowers it further (pure tests).
- [ ] AI lap times on default track within +-10% of pre-change. PENDING
      manual in-game check (needs Rapier + render loop; not jsdom-runnable).
- [ ] No stuck-respawn during 3 AI-only laps on the default track (manual,
      F3). PENDING manual in-game check.
- [x] AiDriver still imports nothing from three/core (pure).

## Depends on

007 (AI/race stack). Feeds 057 (long tracks need this), 059 (width fields),
060 (routeChoice reuses allowedSpeed), 061 (difficulty scales these gains).
