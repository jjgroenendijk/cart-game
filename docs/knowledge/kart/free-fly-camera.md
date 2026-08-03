---
type: Subsystem
title: Free-Fly Camera
description: Spectator free-fly camera, menu-selectable, seeded from the live view.
tags: [kart, camera, hud, agent-tooling]
timestamp: 2026-08-03T06:37:00Z
---

# Free-Fly Camera

A "noclip" spectator camera for freely exploring terrain and inspecting the live
scene, decoupled from the kart chase/menu cameras. Selectable from the main
menu's CAMERA row (`CHASE` | `FREE-FLY`), persisted across sessions, and toggled
in-game with the `KeyC` key. The `?freefly` dev URL flag still forces it on.

## Split

- `src/core/freeFly.ts` — pure input->transform math (WebGL-free, jsdom-tested).
  `stepFreeFly(state, input, dt, opts)` advances an immutable
  `{ position, yaw, pitch }`; `orientationFromYawPitch` derives the world
  orientation (Euler "YXZ", roll-free) and `yawPitchFromQuaternion` is its
  inverse (used to seed the pose from another camera). Conventions match the
  engine: camera forward is local -Z; positive yaw turns look from -Z toward -X,
  positive pitch tilts up. Movement sums full look-forward + horizontal
  camera-right + world-up, normalized so diagonals are not faster; pitch clamps
  near +/-89deg.
- `src/kart/FreeFlyCamera.ts` — GL/DOM wrapper owning a `PerspectiveCamera` and
  the raw device plumbing the math excludes: WASD + Q/E + Shift key state,
  mouse-delta capture, and pointer lock. A persistent window `keydown` toggle on
  `KeyC` enters/exits; movement listeners attach only while active. Pointer-lock
  calls are guarded (`?.`) so the wrapper is inert under jsdom (the pose math
  still runs, so tests drive key/mouse events without a GL context). Mouse:
  `yawDelta = -movementX * SENS`, `pitchDelta = -movementY * SENS` so mouse-right
  looks right and mouse-up looks up. `seedPose(pos, yaw, pitch)` overwrites the
  pose (used on activation so the handoff does not snap) and `pose` exposes a
  copy of the current state for the HUD.

## Game integration

`Game.applyCameraMode(mode)` (`src/core/Game.ts`, on the `FlowHost` surface) is
the single entry point from both the menu and the dev flag. It lazy-constructs
the wrapper + `FreeFlyHud` on first `freefly` selection (so prod pays nothing
until chosen), seeds the pose from the currently-rendering camera (chase while
racing/paused, the menu orbit cam otherwise) via `yawPitchFromQuaternion`, then
`setActive(true)` + shows the HUD; `chase` deactivates + hides it. A zero source
position (e.g. pre-first-frame menu cam) leaves the default spectator vantage.

Each frame `gameFrame` calls `updateFreeFlyHud(g.freeFlyHud, g.freeFly)`
(self-hides when inactive) and `gameDev.renderGameFrame` calls
`freeFly.update(dt)` (no-op while inactive) and, when active, renders the scene
from `freeFly.camera` via `Renderer.render(camera)` (no renderer change). While
active, kart driving input is suppressed (`driving` gates off `freeFly.active`)
so WASD only flies the camera; physics still steps so the world stays live.
`setAspect` runs on resize and `dispose` drops the persistent toggle listener +
removes the HUD.

Selection flow: `StartMenu` CAMERA row -> `GameFlow.onCameraModeChange`
(persists via `cameraModeStorage` + calls `host.applyCameraMode`) — the same
shape as biome/weather. `Game` also re-applies the persisted mode at boot.
`?freefly` rides this path: `applyDevRuntime` calls `g.applyCameraMode("freefly")`.

## HUD

`src/ui/FreeFlyHud.ts` — center MENU_ACCENT reticle + a bottom-left telemetry
block (`POS x y z` / `YAW deg` / `PITCH deg`) in the neutral menuStyles tokens.
cssText set once at construction; `update(pose)` mutates only the readout
textContent; `show/hide/remove`. `formatFreeFlyPose` is exported pure for tests.
Updated per-frame via `hudSync.updateFreeFlyHud`.

## Testing

`src/core/freeFly.test.ts` covers the pose math (pitch clamp, look-direction
movement, boost, yaw rotation) and the `orientationFromYawPitch` <->
`yawPitchFromQuaternion` round-trip. `src/kart/FreeFlyCamera.test.ts` (opted
into jsdom) covers the toggle, key-driven movement, mouse look signs, pitch
clamp, `seedPose`/`pose`, and dispose. `src/ui/FreeFlyHud.test.ts` covers the
formatter + DOM lifecycle.
