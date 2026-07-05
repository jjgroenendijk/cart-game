---
type: System
title: Input
description: Keyboard and gamepad input mapping for up to 2 players.
tags: [input, core]
timestamp: 2026-07-05T00:00:00Z
---

# Input

Owns keyboard and gamepad mapping. P1 uses WASD, P2 uses arrow keys. Follows
the [steering sign convention](/conventions/steering-sign.md): positive steer =
turn left.

## Schema

| Input       | P1 key | P2 key | Steering sign |
| ----------- | ------ | ------ | ------------- |
| Steer left  | A      | Left   | +steer        |
| Steer right | D      | Right  | -steer        |
| Accelerate  | W      | Up     | —             |
| Brake       | S      | Down   | —             |

Gamepad axis 0 (left stick X) is negated: stick right → -steer.

## Citations

- [KartController](/kart/controller.md)
- [Steering Convention](/conventions/steering-sign.md)
