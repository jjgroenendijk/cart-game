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
Derives checkpoint positions from SplineTrack.

# Citations

- [RaceManager](/race/race-manager.md)
- [SplineTrack](/terrain/spline-track.md)
