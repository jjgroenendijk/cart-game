---
type: Subsystem
title: Free-Fly Camera
description: Dev noclip spectator camera for exploring terrain and inspecting the scene.
tags: [kart, camera, debug, agent-tooling]
timestamp: 2026-07-15T00:00:00Z
---

# Free-Fly Camera

A dev "noclip" spectator camera for freely exploring terrain and inspecting the
live scene, decoupled from kart chase/menu cameras. Enabled by the `?freefly`
dev URL flag; toggled in-game with the `KeyC` key.

## Split

- `src/core/freeFly.ts` — pure input->transform math (WebGL-free, jsdom-tested).
  `stepFreeFly(state, input, dt, opts)` advances an immutable
  `{ position, yaw, pitch }`; `orientationFromYawPitch` derives the world
  orientation (Euler "YXZ", roll-free). Conventions match the engine: camera
  forward is local -Z; positive yaw turns look from -Z toward -X, positive
  pitch tilts up. Movement sums full look-forward + horizontal camera-right +
  world-up, normalized so diagonals are not faster; pitch clamps near +/-89deg.
- `src/kart/FreeFlyCamera.ts` — GL/DOM wrapper owning a `PerspectiveCamera` and
  the raw device plumbing the math excludes: WASD + Q/E + Shift key state,
  mouse-delta capture, and pointer lock. A persistent window `keydown` toggle on
  `KeyC` enters/exits; movement listeners attach only while active. Pointer-lock
  calls are guarded (`?.`) so the wrapper is inert under jsdom (the pose math
  still runs, so tests drive key/mouse events without a GL context). Mouse:
  `yawDelta = -movementX * SENS`, `pitchDelta = -movementY * SENS` so mouse-right
  looks right and mouse-up looks up.

## Game integration

`Game` builds the wrapper only when `?freefly` is set (`src/core/Game.ts`),
passing the renderer canvas for pointer-lock capture. Each frame it calls
`freeFly.update(dt)` (a no-op while inactive) and, when active, renders the
scene from `freeFly.camera` via the existing `Renderer.render(camera)` menu hook
(no renderer change). While active, kart driving input is suppressed (`driving`
gates off `freeFly.active`) so WASD only flies the camera; physics still steps
so the world stays live. `setAspect` runs on resize and `dispose` drops the
persistent toggle listener.

## Testing

`src/core/freeFly.test.ts` covers the pose math (pitch clamp, look-direction
movement, boost, yaw rotation). `src/kart/FreeFlyCamera.test.ts` (opted into
jsdom) covers the toggle, key-driven movement, mouse look signs, pitch clamp,
and dispose.
