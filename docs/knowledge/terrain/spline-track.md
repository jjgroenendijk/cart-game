---
type: Subsystem
title: SplineTrack
description: Closed-loop spline providing spawn points, AI pathing, race logic, and minimap source.
tags: [terrain, spline, race]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

SplineTrack is the closed-loop spline and single source of truth for:

| Consumer     | Usage                       |
| ------------ | --------------------------- |
| Spawn system | Start-grid positions        |
| AI drivers   | Path-following target poses |
| Race logic   | Lap counting and progress   |
| Checkpoints  | Segment crossing detection  |
| Minimap      | Track outline rendering     |

Game passes spline `t` poses to race systems. Race code avoids DOM, physics,
and Three scene ownership — it receives only spline poses.

# Examples

```ts
// AI driver queries next target pose ahead of current position
const target = spline.getPose(current.t + lookAhead);

// Checkpoint checks segment crossing
const crossed = checkpoints.checkCrossing(prev.t, current.t, spline);
```

# Citations

- [Circuits](/terrain/circuits.md)
- [RaceManager](/race/race-manager.md)
- [AiDriver](/race/ai-driver.md)
- [Checkpoints](/race/checkpoints.md)
