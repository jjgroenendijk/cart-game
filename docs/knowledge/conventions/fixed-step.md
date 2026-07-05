---
type: Convention
title: Fixed-Step Simulation
description: Physics and game logic run at fixed 1/60s timestep with capped accumulator.
tags: [physics, simulation, convention]
timestamp: 2026-07-05T00:00:00Z
---

# Fixed-Step Simulation

Physics and game logic run at a fixed timestep of 1/60s, decoupled from the
render frame rate.

## Accumulator

The frame delta is accumulated into a time accumulator. The accumulator is
processed in fixed 1/60s steps, clamped to `MAX_STEPS=5` per frame. Excess
accumulated time beyond 5 steps is dropped to prevent spiral-of-death.

## Visual Interpolation

Kart visual pose is interpolated between the previous and current physics state
using the remaining accumulator fraction (`accumulator / STEP`). On respawn or
teleport, the visual pose snaps directly to the physics state (no lerp).

## Rationale

Avoids variable-dt physics changes, ensuring deterministic and stable
simulation across frame rate fluctuations.

## Related

- [Game](/core/game.md)
