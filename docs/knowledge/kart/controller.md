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

# Citations

- [KartMesh](/kart/kart-mesh.md)
- [RaceManager](/race/race-manager.md)
- [Input](/core/input.md)
