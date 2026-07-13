---
type: Subsystem
title: Mobile Controls
description: On-screen touch pedals plus accelerometer tilt steering for phones.
tags: [ui, input, mobile, touch, accelerometer, dom]
timestamp: 2026-07-13T00:00:00Z
---

# Mobile Controls

`src/ui/MobileControls.ts` is a DOM overlay that lets a phone drive the single
human kart (player 0). It follows the RaceHud/Minimap overlay pattern: owns its
nodes, `cssText` set once, `pointer-events:none` root with `pointer-events:auto`
children, visible only while racing. It never reads input itself — every gesture
writes into the shared [`Input`](/core/input.md) via `setTouch*` setters, on the
same axes keyboard/gamepad use.

## Controls

| Control   | Gesture | Input axis                              |
| --------- | ------- | --------------------------------------- |
| GAS (▲)   | hold    | `throttle` +1                           |
| BRAKE (▼) | hold    | `throttle` -1 (brake/reverse, one axis) |
| ◀ / ▶     | hold    | `steer` +1 (left) / -1 (right)          |
| DRIFT     | hold    | `drift` true                            |
| RESET     | tap     | one-shot `reset` latch                  |
| TILT      | toggle  | arms accelerometer steering             |
| INVERT    | toggle  | flips tilt left/right (tilt mode only)  |

Steering follows the [steering-sign convention](/conventions/steering-sign.md):
positive steer = turn left. Buttons use pointer events with per-element pointer
capture so pedal + steer presses are independent multi-touch. GAS/BRAKE recompute
`throttle` from both hold flags so a both-held state cancels; ◀/▶ recompute
`steer` the same way but yield to tilt while it is active.

## Tilt (accelerometer) steering

Tilt replaces the ◀/▶ buttons with a `deviceorientation` listener. The pure math
is `src/core/tiltSteer.ts` (unit-testable without a device):

- `resolveTiltAxis(angle)` picks the Euler axis + sign for the current screen
  orientation: portrait (0/180) rolls about `gamma`, landscape (90/270) about
  `beta`. Signs are the common iOS Safari mapping; the INVERT toggle corrects
  devices that report the opposite.
- The first reading after enable (or after an `orientationchange`) calibrates a
  neutral baseline, so a flat hold reads 0 regardless of how the phone is held.
- `tiltToSteer(reading, opts)` subtracts the neutral, applies a degree deadzone,
  normalizes over `rangeDeg` (default 28°), clamps to [-1, 1], and returns the
  steering-sign value: dropping the right edge steers right (negative).

iOS 13+ gates `DeviceOrientationEvent` behind `requestPermission()`, which must
run from a user gesture — the TILT toggle tap is that gesture. Android/desktop
have no gate, so a persisted `tiltEnabled` preference auto-arms on `show()`.
`isTouchDevice()` (coarse pointer OR `maxTouchPoints > 0`) decides whether the
overlay renders at all; it stays hidden on desktop.

## Persistence

`src/core/mobileControlsStorage.ts` persists `{ tiltEnabled, invert }` under
`gamecart.mobileControls.v1` (versioned, try/catch-guarded, mirrors
[circuitStorage](/core/persistence.md)). The iOS permission itself is not
persisted — it needs a fresh gesture each session.

## Lifecycle

`Game` constructs one `MobileControls` and toggles it in the frame loop:
`show()` while `flow.state === "racing"`, else `hide()`. `hide()` drops every
held contribution back to zero via `Input.clearTouch()`, and `onOrient` ignores
readings while hidden, so a backgrounded overlay never steers. `remove()` (from
`Game.dispose`) detaches the `deviceorientation`/`orientationchange` listeners.

## Citations

- [Input](/core/input.md)
- [Steering Convention](/conventions/steering-sign.md)
- [UI Overlays](/ui/overlays.md)
