---
type: Subsystem
title: Checkpoints
description: Cut-proof lap validation preventing lap duplication and ensuring correct traversal.
tags: [race, checkpoints]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Owns cut-proof lap validity. Prevents lap duplication (must cross all checkpoints in order).

Single source of truth for lap rules — do not duplicate elsewhere.

Sector boundaries are **purely parametric** — no SplineTrack dependency.
`buildSectorBoundaries(k)` returns `[0, 1/k, 2/k, ..., (k-1)/k]` — simple arithmetic
divisions of the [0,1) loop. `DEFAULT_SECTOR_COUNT = 6`.

## Core functions

- **`wrap01(t): number`** — wrap into [0,1).
- **`signedWrapDelta(prev, curr): number`** — signed shortest delta in (-0.5, 0.5].
- **`sectorIndex(t, k): number`** — sector index 0..k-1.
- **`buildSectorBoundaries(k?): number[]`** — parametric gate boundaries.
- **`trackProgress(prevT, currT, k): TrackProgress`** — wrap-aware per-step progress.
- **`initialLapState(t?, k?): LapState`** — fresh state behind start line.
- **`advanceLap(state, currT, k?): LapEvent`** — advance lap validity one step.

## Gate chain mechanics

`LapState` fields: `lap` (int), `nextGate` (0..K), `lastSector`, `lastT`, `primed`.

`nextGate` starts at 0 ("not yet begun"). A forward start-line crossing (sector K-1 -> 0)
sets it to 1. Forward entry into sector `nextGate` advances it by 1. Reaching `nextGate >= K`
and crossing the line forward completes a lap (lap++), then `nextGate` resets to 1.

Skipping a gate (entering a future sector out of order), crossing the line early, or
teleporting (> `FORWARD_CUT = 0.34` or > `BACKWARD_CUT = 0.34`) resets the chain (cut).

## TrackProgress

| Field          | Role                                         |
| -------------- | -------------------------------------------- |
| `forwardDelta` | Signed wrap-aware delta; negative = backward |
| `prevSector`   | Sector at prevT                              |
| `sector`       | Sector at currT                              |

## LapTracker

Class wrapping `advanceLap` with per-kart state:

- `constructor(sectorCount)` — initializes with `initialLapState`
- `update(currT)` — returns `{ lapCompleted, cut }`
- `reset(t)` — reset chain behind start line
- Properties: `lap`, `nextGate`, `sectorCount`

# Citations

- [RaceManager](/race/race-manager.md)
- [SplineTrack](/terrain/spline-track.md)
