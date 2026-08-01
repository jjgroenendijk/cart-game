---
type: System
title: Game
description: "Central orchestrator: composition, lifecycle, field rebuilds, simulation, render."
tags: [core, lifecycle, orchestration]
timestamp: 2026-07-30T22:30:45Z
---

# Game

Entry point `main.ts` bootstraps Rapier then creates Game. Game owns the
top-level composition, manages field rebuilds (terrain, environment, karts,
race), runs the [fixed-step simulation](/conventions/fixed-step.md), dispatches
rendering, and handles resize.

Delegates screen flow to [GameFlow](/core/game-flow.md) via the FlowHost
interface. Reads `flow.state` in `frame()`.

Delegates field-level state (the single human view, AI rivals, RaceManager,
RaceHud, VFX, skid marks) to `this.field: FieldBuilder`, the actual sub-owner.
Game exposes accessors (`view`, `rivals`, `race`, `raceHud`) that forward to it.

Cross-subsystem orchestration lives in Game; reusable rules live in pure modules
near their domain. To keep the orchestrator under the file cap, dev/agent glue
lives in `src/core/gameDev.ts` (`gameDebugSnapshot`, `applyDevRuntime` for the
`?freefly`/`?quality`/`?autostart` runtime overrides, and the per-frame
`renderGameFrame` dispatch), the per-frame loop body in
`src/core/gameFrame.ts` (`runGameFrame`, to which `Game.frame` is a one-line
delegate), and the minimap polyline builder in `src/core/minimapShape.ts`.
Game exposes the fields these read: dev glue reads (`env`, `time`,
`qualityTier`, `perfEwma`, `freeFly`, `flow`, `menuCamera`); the frame body
additionally reads/writes `running`, `last`, `acc`, `raf`, `input`, `touch`,
`field`, `gameAudio`, `menuFocusX`, `menuFocusZ`, `results`, `resultsShown`,
plus the `stepWorld` and `updateColliderFoci` methods. `STEP`/`MAX_STEPS` now
live in `gameFrame.ts`.

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

| Field      | Description                      |
| ---------- | -------------------------------- |
| `flow`     | GameFlow instance (FlowHost)     |
| `renderer` | Renderer instance                |
| `physics`  | PhysicsWorld (Rapier)            |
| `input`    | Input instance (single player)   |
| `view`     | PlayerView getter (single human) |
| `current`  | CircuitId (seed + biome index)   |

## Tests

Game tests live in `src/core/Game.test.ts` plus 9 subject-split siblings
(Game.biome, Game.devFlags, Game.env-focus, Game.pause, Game.rebuild,
Game.select, Game.settings, Game.shadow-target, Game.terrain); all
share `Game.test.mocks.ts` for the Renderer/Physics/Terrain/Environment/
FieldBuilder vi.mock side-effects and duplicate the getContext/makeGame
helpers per file.

## Citations

- [GameFlow](/core/game-flow.md)
- [Renderer](/core/renderer.md)
- [RaceManager](/race/race-manager.md)
