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

`src/core/viewDescriptors.ts` exports `syncViewDescs(descs, views)`, which
syncs a pooled `ViewDescriptor[]` (camera + rect refs) from live
`PlayerView[]`. This is the bridge between PlayerView state and the
Renderer's split-screen viewport computation. It reuses the same array
across frames (no per-frame allocation).

## Citations

- [ChaseCamera](/kart/kart-mesh.md)
- [GameFlow](/core/game-flow.md)
- [Game](/core/game.md)
