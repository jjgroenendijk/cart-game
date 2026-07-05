---
type: System
title: PlayerView
description: Per-human kart, camera, viewport, and speed-HUD binding.
tags: [core, camera, viewport]
timestamp: 2026-07-05T00:00:00Z
---

# PlayerView

Owns per-human bindings: kart reference, ChaseCamera, viewport rect, and
speed-HUD element. Human karts occupy indices `0..humanCount-1`; rivals follow
after.

## Schema

| Field      | Description                        |
| ---------- | ---------------------------------- |
| `kart`     | Reference to human Kart            |
| `chaseCam` | ChaseCamera instance               |
| `rect`     | Viewport rect (bottom-left CSS px) |
| `lifeBar`  | Per-view LifeBar instance          |

`speedEl` (private readonly) holds the speed-HUD DOM element.

## Citations

- [ChaseCamera](/kart/kart-mesh.md)
- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
