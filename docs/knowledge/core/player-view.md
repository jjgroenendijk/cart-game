---
type: System
title: PlayerView
description: Single-player kart, camera, viewport, and speed-HUD binding.
tags: [core, camera, viewport]
timestamp: 2026-07-30T22:30:45Z
---

# PlayerView

Owns the single player's bindings: kart reference, ChaseCamera, viewport rect
(full screen), and speed-HUD element. The human kart occupies grid index 0;
AI rivals follow.

## Schema

| Field      | Description                        |
| ---------- | ---------------------------------- |
| `kart`     | Reference to human Kart            |
| `chaseCam` | ChaseCamera instance               |
| `rect`     | Viewport rect (bottom-left CSS px) |
| `lifeBar`  | LifeBar instance                   |

`speedEl` (private readonly) holds the speed-HUD DOM element.

The full-screen `ViewDescriptor` (camera + rect) is built inline at render
dispatch (`Renderer.renderView` / `Renderer.render`); there is no pooled
descriptor array. `viewHudAnchor` anchors the HUD inside the rect.

## Citations

- [ChaseCamera](/kart/kart-mesh.md)
- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
