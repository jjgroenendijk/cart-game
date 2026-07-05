---
type: Subsystem
title: Race Manager
description: "Race lifecycle state machine: countdown, lap tracking, finish detection, ranking."
tags: [race, state-machine]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Manages full race lifecycle: countdown start, lap tracking, finish detection, and ranking.

1P finish mode is leader; 2P finish mode is allHumans. raceRanking.ts handles position tracking.

Race code is pure-ish: receives spline `t` poses from Game, avoids DOM/physics/Three ownership.

# Citations

- [Checkpoints](/race/checkpoints.md)
- [AiDriver](/race/ai-driver.md)
- [SplineTrack](/terrain/spline-track.md)
- [Game](/core/game.md)
