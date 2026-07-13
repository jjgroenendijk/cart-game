---
type: System
title: Input
description: Keyboard, gamepad, and touch/tilt input mapping for up to 2 players.
tags: [input, core]
timestamp: 2026-07-13T00:00:00Z
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

Gamepad axis 0 (left stick X) is negated: stick right → -steer. Gamepad axis 1
(left stick Y) contributes throttle via `deadzone(ax1)`. Gamepad buttons: RT
(index 7) for throttle, LT (index 6) for brake, A/cross (button 0) for drift,
B/circle (button 1) for reset. `AXIS_DEADZONE = 0.18` is applied to both stick
axes. `zeroInput()` returns a fresh all-zero `KartInput` object (used when not
driving).

## Touch / tilt merge (player 0)

Phones drive via [MobileControls](/ui/mobile-controls.md), which writes into the
same `Input` on the same axes as keyboard/gamepad using the `setTouchSteer` /
`setTouchThrottle` / `setTouchDrift` setters plus a one-shot `pulseTouchReset`
latch. `sample()` merges these contributions only for player 0 (after
keyboard/gamepad, before the final `clamp`), consuming the reset latch on read.
`clearTouch()` zeroes every contribution when the controls hide. Desktop leaves
them all 0/false, so the merge is a no-op there.

## Citations

- [KartController](/kart/controller.md)
- [Steering Convention](/conventions/steering-sign.md)
- [Mobile Controls](/ui/mobile-controls.md)
