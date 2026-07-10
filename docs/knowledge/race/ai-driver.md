---
type: Subsystem
title: AI Driver
description: Pure-pursuit steering AI with braking-distance speed model and stuck-recovery logic.
tags: [race, ai]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

The module `src/race/AiDriver.ts` exports a single **pure function** — there is no class.
`produceInput(pose, ahead, rivals, tuning, rng): KartInput` is deterministic given the RNG
sequence; same seed produces the same input series. No Game/physics/Three deps.

Behaviour:

- **Steering**: pure-pursuit toward a speed-scaled lookahead point on the spline.
  Lookahead lerps near..far so fast karts aim further ahead.
- **Throttle**: braking-distance speed cap via `aiSpeed.ts`. Full throttle under
  allowed speed, proportional lift to zero above it.
- **Avoidance**: rivals within `avoidRadius` add lateral steer away.
- **Stuck**: slow + off-corridor for >= `stuckTime` requests a reset (`reset: true`);
  Game respawns the kart at the nearest spline-ahead point.
- **Drift**: always `false`. AI drifting is a documented non-goal.

Rivals occupy indices after human karts.

## Function signature

```ts
produceInput(
  pose: AiPose,
  ahead: readonly AiSplinePoint[],
  rivals: readonly AiRival[],
  tuning: AiTuning,
  rng: RNG,
): KartInput
```

## Input types

- **`AiPose`** — current kart state.
  Fields: `pos: {x,z}`, `forward: {x,z}`, `speed`, `corridorDist`,
  `corridorHalfWidth`, `stuckSeconds`.
- **`AiSplinePoint`** — sample point ahead on the spline.
  Fields: `x`, `z`, `halfWidth`.
- **`AiRival`** — other kart positions for avoidance. Fields: `x`, `z`.

## Steering constants

| Constant     | Value | Role                                                           |
| ------------ | ----- | -------------------------------------------------------------- |
| `STEER_GAIN` | 1.25  | Pure-pursuit angle -> steer multiplier                         |
| `AVOID_GAIN` | 0.6   | Rival avoidance lateral steer gain                             |
| `SPEED_EASE` | 3     | m/s band over which throttle eases full->0 above allowed speed |

Follows [steering sign convention](/conventions/steering-sign.md): positive steer = turn left.

## AI Tuning

Each AI rival gets distinct tuning so they don't all behave identically.
Tuning lives in `src/race/aiTuning.ts`.

`AiTuning` interface fields:

| Field           | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `lookaheadNear` | Lookahead distance (m) at near-zero speed                        |
| `lookaheadFar`  | Lookahead distance (m) at top speed                              |
| `aggression`    | Throttle aggression 0..1 (higher brakes later in corners)        |
| `maxSpeedScale` | Target-speed scale vs kart maxSpeed (rubber-band modulates this) |
| `refMaxSpeed`   | Reference top speed for the speed->lookahead mapping (rival max) |
| `avoidRadius`   | Rival repulsion radius (m)                                       |
| `stuckSpeed`    | Below this forward speed (m/s) a kart counts as stuck            |
| `stuckTime`     | Seconds slow + off-corridor before a reset is requested          |

- `makeAiTuning(baseSeed, kartIndex)` — builds a deterministic per-rival
  tuning with skill jitter. Same `(baseSeed, kartIndex)` always yields the
  same personality; bands match the defaults below.
- `withSpeedScale(base, scale)` — applies rubber-band speed scaling on a
  copy of a tuning (floor 0.7 on `maxSpeedScale`). Called by RaceManager.
- `DEFAULT_AI_TUNING` — base defaults at the centre of each band:
  `lookaheadNear 6`, `lookaheadFar 14`, `aggression 0.85`,
  `maxSpeedScale 0.96`, `refMaxSpeed AI_REF_MAX_SPEED`, `avoidRadius 4`,
  `stuckSpeed 2`, `stuckTime 2`.
- `AI_REF_MAX_SPEED` — reference top speed constant (`34`), the
  speed->lookahead mapping reference using P1 DEFAULT_TUNING.

## Speed model (`src/race/aiSpeed.ts`)

Braking-distance throttle cap. For each sampled ahead-point:

1. Menger radius from three consecutive points:
   `R = |ab| * |bc| * |ca| / (2 * |cross(ab, bc)|)`.
2. Corner speed: `vCorner = sqrt(A_LAT * R)` where
   `A_LAT = A_LAT_BASE * (0.85 + 0.3 * aggression)`.
3. Brake-lifted candidate (decel from distance d):
   `vBrake = sqrt(vCorner^2 + 2 * A_BRAKE * d)`.
4. Width scale: `* sqrt(halfWidth / REF_HALF_WIDTH)`.
5. `allowedSpeed = min(vBrake)` across the horizon.

Constants: `A_LAT_BASE = 10`, `A_BRAKE = 8`. Throttle is full under
allowed speed, proportional lift to zero above it (eased over
`SPEED_EASE` m/s). Per-variant `maxSpeedScale` clips the ceiling.

# Citations

- [RaceManager](/race/race-manager.md)
- [SplineTrack](/terrain/spline-track.md)
- [KartController](/kart/controller.md)
