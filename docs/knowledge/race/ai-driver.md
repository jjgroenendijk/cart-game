---
type: Subsystem
title: AI Driver
description: Pure-pursuit steering AI with rubber-band speed tuning and stuck-recovery logic.
tags: [race, ai]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Pure-pursuit steering controller for rival karts. Rubber-band speed tuning
(aiSpeed.ts, aiTuning.ts) keeps races competitive.

Stuck recovery logic detects and resolves trapped rivals. Returns KartInput;
Game handles respawn side effects.

Follows [steering sign convention](/conventions/steering-sign.md).
Rivals occupy indices after human karts.

# Citations

- [RaceManager](/race/race-manager.md)
- [SplineTrack](/terrain/spline-track.md)
- [KartController](/kart/controller.md)
