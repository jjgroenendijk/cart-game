---
type: Subsystem
title: Debug Snapshot
description: window.__game.debugSnapshot() whole-game JSON state dump for dev/agent inspection.
tags: [core, debug, agent-tooling]
timestamp: 2026-07-15T00:00:00Z
---

# Debug Snapshot

`window.__game.debugSnapshot()` returns one plain, JSON-serializable object
describing the whole live game state. It exists so a dev console or an
out-of-process agent (headless Chrome via CDP) can inspect the running game
without hand-walking the Three.js/Rapier object graph. `main.ts` already exposes
`window.__game`; the method hangs off it (no extra global).

## Assembly

`Game.debugSnapshot()` in `src/core/Game.ts` reads the live subsystems and
delegates all shaping + copying to the pure assembler `buildDebugSnapshot` in
`src/core/debugSnapshot.ts`. The assembler imports no Game, no THREE, no WebGL:
every input arrives through an injected accessor bag, so jsdom specs feed it
fakes and the real wiring feeds it live state through the same door.

Per-kart state is serialized by `kartToJSON` in `src/kart/kartSnapshot.ts`.

## Shape

```text
{ state, time, seed, biome, weather, day, quality, perf, race, karts[] }
```

- `state` — GameFlow screen state (`menu`/`racing`/…).
- `seed`/`biome` — the current `CircuitId`; `biome` is the `BiomeId` string.
- `weather` — `Environment.weatherInfo` (`{preset, level, elapsed, seed}`).
- `day` — the JSON-safe numeric/phase subset of the `dayCycleState` singleton
  (`src/environment/dayCycle.ts`). The `THREE.Color`/`Vector3` fields are
  excluded: they alias pooled scratch and are not JSON-serializable.
- `quality` — the active tier, mirrored on `Game` (`Renderer` applies
  `DEFAULT_QUALITY` at construction; `Game.setQuality` keeps the mirror in
  sync).
- `perf` — a `PerfSample` (`src/core/stats.ts`) adapted from
  `Renderer.getFrameStats()` plus a `FrameMsEwma` smoothed frame time held on
  `Game`. `getFrameStats()` returns `FrameStats` (calls/triangles/…), which is
  NOT a `PerfSample`; `Game.perfSample()` maps `calls`→`drawCalls`,
  `triangles`→`tris`, and derives `frameMs`/`fps`.
- `race` — `RaceManager.snapshot()`, deep-copied.
- `karts` — every human kart (`views[i].kart`) followed by every rival
  (`rivals[i]`), each via `kartToJSON`.

## Copying invariants

Two live sources alias reused buffers, so the assembler copies eagerly:

- `RaceManager.snapshot()` reuses an internal buffer across calls; `copyRace`
  slices the arrays and clones each `KartProgress` row.
- `kartToJSON` reads the AUTHORITATIVE Rapier body
  (`controller.body.translation()/rotation()/linvel()/angvel()`), NOT the
  frame-interpolated `kart.group.position`. Every vector/quat is copied
  field-by-field into a fresh literal so nothing aliases Rapier scratch.

## Testing

Pure and jsdom-safe: `src/core/debugSnapshot.test.ts` and
`src/kart/kartSnapshot.test.ts` feed structural fakes and assert shape,
buffer-independence, and JSON-serializability. The Game-level wiring is exercised
at runtime (browser / headless harness), since the jsdom Game mocks stub karts
without real Rapier bodies.
