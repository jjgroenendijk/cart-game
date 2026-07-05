---
type: Subsystem
title: KartController
description: "Rapier impulse-based kart physics: suspension, wheel grip, drift, reset, buoyancy."
tags: [kart, physics, rapier]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Owns all kart physics via Rapier impulses. Suspension: raycasts to terrain trimesh collider.
Wheel grip model. Drift mechanics. Kart reset on out-of-bounds or manual reset.
Water buoyancy and life drain (buoyancy.ts).

Runs at [fixed step 1/60](/conventions/fixed-step.md).
Steering follows [sign convention](/conventions/steering-sign.md): positive steer = turn left.

Physics visual sync via kart mesh lerp (prev->current by acc/STEP; snaps on respawn).

## Spawn clearance

Spawn Y must place the body origin at or above the suspension rest pose so the
springs start uncompressed; spawning below rest compresses the spring on step 1
and launches the kart. `spawnClearance(tuning)` derives the body-origin height
above terrain from the ray origin offset (`WHEEL_RAY_ORIGIN_Y` -0.05) + rest
length (`suspensionRest + wheelRadius`) + a small settle buffer, so each variant
spawns at the right height for its own wheels. `FieldBuilder.build()` samples
`heightAt(x,z)` + `spawnClearance(variant.tuning)` per kart slot. The same pose
feeds the constructor and `respawn()`, so manual reset is also covered.
`KartGrid.clearance` (default 0.5) is now only a fallback Y for the grid's own
bookkeeping; `FieldBuilder` overrides it per kart.

Big props (trees, rocks) merge into spatial buckets (one mesh per bucket);
Rapier colliders stay per-prop, unchanged by merging. This keeps the physics
world correct while optimizing draw calls.

## KartInput

Defined in `core/Input.ts`, consumed by `KartController.fixedUpdate()`:

| Field      | Type    | Range   | Meaning                                      |
| ---------- | ------- | ------- | -------------------------------------------- |
| `steer`    | number  | [-1, 1] | Positive = turn left                         |
| `throttle` | number  | [-1, 1] | Positive = forward, negative = brake/reverse |
| `drift`    | boolean |         | Whether the drift modifier is active         |
| `reset`    | boolean |         | Request a respawn this step (consumed once)  |

`Input.sample(player)` produces `KartInput` from keyboard + gamepad.
`AiDriver.produceInput()` produces `KartInput` for AI karts.

## KartTuning

`KartTuning` is a plain data interface (18 numeric fields) holding all tunable
physics constants. `DEFAULT_TUNING` provides the stock values; each `KartController`
receives a copy at construction.

| Field                 | Default | Role                                    |
| --------------------- | ------- | --------------------------------------- |
| `mass`                | 260     | Rigid body mass (kg)                    |
| `engineForce`         | 9000    | Forward impulse scalar at full throttle |
| `brakeForce`          | 11000   | Braking impulse scalar                  |
| `maxSpeed`            | 34      | Top forward speed (m/s)                 |
| `reverseSpeed`        | 12      | Top reverse speed (m/s)                 |
| `maxSteerRate`        | 2.6     | Maximum yaw angular velocity (rad/s)    |
| `topSpeedSteerFactor` | 0.55    | Speed-dependent steer reduction         |
| `grip`                | 9.5     | Lateral grip factor (normal)            |
| `driftGrip`           | 1.6     | Lateral grip factor (drifting)          |
| `driftBoost`          | 1.12    | Speed cap multiplier while drifting     |
| `coastDecel`          | 4       | Coasting deceleration (m/s per s)       |
| `suspensionStiffness` | 42000   | Spring stiffness                        |
| `suspensionDamping`   | 3600    | Spring damping                          |
| `suspensionRest`      | 0.3     | Rest length of each spring (m)          |
| `suspensionTravel`    | 0.25    | Max compression extension (m)           |
| `wheelRadius`         | 0.35    | Visual + raycast wheel radius (m)       |
| `uprightTorque`       | 28      | Torque that rights the kart             |
| `uprightAngDamping`   | 4       | Damping on pitch/roll angular velocity  |

# Citations

- [KartMesh](/kart/kart-mesh.md)
- [RaceManager](/race/race-manager.md)
- [Input](/core/input.md)
