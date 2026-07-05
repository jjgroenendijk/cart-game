---
type: Subsystem
title: AI Driver
description: Pure-pursuit steering AI with rubber-band speed tuning and stuck-recovery logic.
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

# Citations

- [RaceManager](/race/race-manager.md)
- [SplineTrack](/terrain/spline-track.md)
- [KartController](/kart/controller.md)
