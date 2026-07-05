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

Delegates field-level state (karts, rivals, RaceManager, RaceHuds, player views,
VFX, skid marks) to `this.field: FieldBuilder`, the actual sub-owner. Game
exposes accessors (`views`, `rivals`, `race`, `raceHuds`) that forward to it.

Cross-subsystem orchestration lives in Game; reusable rules live in pure modules
near their domain.

## Circuit identity

Game carries a `current: CircuitId` (`{ seed, biome }`, see
`terrain/circuitCode.ts`) that selects both the mainline shape (seed) and the
biome (index). At boot `loadCircuitId()` reads `gamecart.circuit.v1` from
localStorage (falls back to `DEFAULT_ID` = seed 1, temperate); the boot world is
seed 1, not a hardcoded showcase seed. `currentBiome` is now a derived getter
(`biomeByIndex(current.biome).id`) so the external surface stays `BiomeId`.
`buildWorld(id)` / `rebuildWorld(id?)` take a CircuitId; player-driven rebuilds
persist the chosen circuit via `saveCircuitId`. GameFlow translates biome ↔
CircuitId at the boundary (keeps the current seed, swaps the biome index).

## Schema

| Field      | Description                       |
| ---------- | --------------------------------- |
| `flow`     | GameFlow instance (FlowHost)      |
| `renderer` | Renderer instance                 |
| `physics`  | PhysicsWorld (Rapier)             |
| `input`    | Input instance (P1 + P2)          |
| `views`    | PlayerView[] getter (human first) |
| `current`  | CircuitId (seed + biome index)    |

## Citations

- [GameFlow](/core/game-flow.md)
- [Renderer](/core/renderer.md)
- [RaceManager](/race/race-manager.md)
