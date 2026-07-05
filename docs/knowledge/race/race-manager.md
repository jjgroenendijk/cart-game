---
type: Subsystem
title: Race Manager
description: "Race lifecycle state machine: grid start, lap tracking, finish detection, ranking."
tags: [race, state-machine]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Manages the race state machine with three phases: `"grid"`, `"racing"`, `"finished"`.
RaceManager does NOT own the countdown — that is handled by `core/GameFlow.ts` and the
DOM countdown overlay. The countdown runs before `startRace()` transitions into `"racing"`.

`update(dt, poses)` is a no-op unless `phase === "racing"`. Each step accrues
the timer, per-kart progress (lap via `LapTracker`, cumulative arc length),
recomputes rank via `raceRanking.ts`, and finishes exactly once when
`finishWhen` is satisfied.

1P finish mode is `"leader"`; 2P finish mode is `"allHumans"`.

Race code is pure-ish: receives spline `t` poses from Game, avoids DOM/physics/Three ownership.

## Configuration

`RaceConfig` fields:

| Field         | Default                    | Role                              |
| ------------- | -------------------------- | --------------------------------- |
| `kartCount`   | (required)                 | Number of karts in the race       |
| `targetLaps`  | `DEFAULT_TARGET_LAPS = 3`  | Laps needed to finish             |
| `sectorCount` | `DEFAULT_SECTOR_COUNT = 6` | Checkpoint gates per lap          |
| `gridT`       | `(k-1)/k`                  | Start-line anchor t for all karts |
| `rubberBand`  | `true`                     | Enable rubber-band speed scaling  |
| `finishWhen`  | `"leader"`                 | Finish trigger mode               |
| `humanCount`  | `1`                        | Human karts at front of grid      |

## Rubber-band

`rubberBandScale(index)` returns a speed scale for AI karts relative to P1.
`RUBBER_FULL_GAP = 0.15` (loop fraction) is the arc-length gap at which the band
reaches full strength. Trailing rivals get up to +0.08 boost; leading rivals
ease off to -0.05. P1 always returns 1.

## KartProgress

| Field        | Role                                                  |
| ------------ | ----------------------------------------------------- |
| `lap`        | Current lap count                                     |
| `sectorIdx`  | Current sector index (0..k-1)                         |
| `cumArcLen`  | Cumulative forward arc length (loop units, monotonic) |
| `lastT`      | Last observed loop parameter                          |
| `finished`   | True once kart has completed target laps              |
| `finishTime` | Race time at finish, or null                          |

## RaceSnapshot

`snapshot()` returns a zero-allocation `RaceSnapshot` (reuses pre-allocated buffers).
Callers must read it synchronously before the next `snapshot()` call overwrites it.

| Field       | Role                                   |
| ----------- | -------------------------------------- |
| `phase`     | Current RacePhase                      |
| `timer`     | Race timer (seconds)                   |
| `leaderLap` | Leader's current lap                   |
| `positions` | Index -> 1-based position (1 = leader) |
| `order`     | Best-to-worst kart index order         |
| `progress`  | Per-kart KartProgress[]                |

## startRace

`startRace()` resets all timers, lap trackers, and progress; transitions `phase` to `"racing"`.
Idempotent.

# Citations

- [Checkpoints](/race/checkpoints.md)
- [AiDriver](/race/ai-driver.md)
- [SplineTrack](/terrain/spline-track.md)
- [Game](/core/game.md)
- [GameFlow](/core/game-flow.md)
