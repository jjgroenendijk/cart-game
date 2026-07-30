---
type: System
title: Input
description: Keyboard, gamepad, and mobile touch/tilt input mapping for a single player.
tags: [input, core]
timestamp: 2026-07-30T22:30:45Z
---

# Input

Owns keyboard and gamepad mapping. A single binding merges WASD + Arrow keys
(`up: ["KeyW","ArrowUp"]`, etc.); there is no P2. Follows the [steering sign
convention](/conventions/steering-sign.md): positive steer = turn left.

## Schema

| Input       | Keys      | Steering sign |
| ----------- | --------- | ------------- |
| Steer left  | A / Left  | +steer        |
| Steer right | D / Right | -steer        |
| Accelerate  | W / Up    | —             |
| Brake       | S / Down  | —             |

Gamepad axis 0 (left stick X) is negated: stick right → -steer. Gamepad axis 1
(left stick Y) contributes throttle via `deadzone(ax1)`. Gamepad buttons: RT
(index 7) for throttle, LT (index 6) for brake, A/cross (button 0) for drift,
B/circle (button 1) for reset. `AXIS_DEADZONE = 0.18` is applied to both stick
axes. `zeroInput()` returns a fresh all-zero `KartInput` object (used when not
driving).

## Mobile touch + tilt (P1 only)

On touch devices a third source produces a `KartInput` for player 0 that is
merged over the keyboard/gamepad sample. On-screen buttons drive
throttle/brake/drift/reset; the device-orientation sensor drives steer. The DOM
overlay and the `deviceorientation` listener live in
[TouchControls](/ui/overlays.md); the pure math lives in `src/core/deviceInput.ts`:

- `isTouchDevice()` — `navigator.maxTouchPoints > 0 || matchMedia("(pointer:
coarse)")`, guarded for jsdom.
- `pickTiltAngle(orientationAngle, beta, gamma)` — picks the left/right roll
  axis from `screen.orientation.angle` (portrait → gamma, landscape → ±beta).
- `tiltToSteer(angle, baseline, {sensitivity, invert, deadzoneDeg, maxDeg})` —
  delta from the captured neutral baseline → steer in [-1, 1], deadzoned,
  scaled, clamped; rolling right → -steer (turn right) per the sign convention.
  `invert` flips it for devices that report the opposite sign.

iOS 13+ requires a user gesture to grant sensor access, so tilt is armed by an
explicit "enable" tap (see TouchControls); until granted, touch steer is 0. The
enable prompt is shown on the start menu (`showMenu`), so permission is granted
before driving; the on-screen pedals appear only while racing (`showRace`).

## Citations

- [KartController](/kart/controller.md)
- [Steering Convention](/conventions/steering-sign.md)
- [TouchControls overlay](/ui/overlays.md)
