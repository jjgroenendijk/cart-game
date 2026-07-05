---
type: System
title: Game
description: "Central orchestrator: composition, lifecycle, field rebuilds, simulation, render."
tags: [core, lifecycle, orchestration]
timestamp: 2026-07-05T00:00:00Z
---

# Game

Entry point `main.ts` bootstraps Rapier then creates Game. Game owns the
top-level composition, manages field rebuilds (terrain, environment, karts,
race), runs the [fixed-step simulation](/conventions/fixed-step.md), dispatches
rendering, and handles resize.

Delegates screen flow to [GameFlow](/core/game-flow.md) via the FlowHost
interface. Reads `flow.state` in `frame()`.

Cross-subsystem orchestration lives in Game; reusable rules live in pure modules
near their domain.

## Schema

| Field          | Description                      |
| -------------- | -------------------------------- |
| `flow`         | GameFlow instance (FlowHost)     |
| `renderer`     | Renderer instance                |
| `physicsWorld` | Rapier physics world             |
| `input`        | Input instance (P1 + P2)         |
| `playerViews`  | PlayerView[] (human karts first) |

## Citations

- [GameFlow](/core/game-flow.md)
- [Renderer](/core/renderer.md)
- [RaceManager](/race/race-manager.md)
