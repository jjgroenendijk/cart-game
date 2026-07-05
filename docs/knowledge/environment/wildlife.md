---
type: Subsystem
title: Wildlife
description: Ambient wildlife placement and rendering via pure helpers + InstancedMesh
tags: [environment, dressing, wildlife]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Two-phase ambient wildlife: `critters.ts` handles pure placement + orbit
pose (WebGL-free, jsdom-testable), and `Wildlife.ts` owns the
`InstancedMesh` GL resources. Biome-optional: temperate opts out via
`wildlife []`.

# critters.ts

Pure placement + orbit-pose helpers. No THREE geometry or rendering.

- `placeCritters(terrain, opts)` — deterministic jittered-grid sampler.
  Sub-seeds the RNG with `(seed ^ hashSeed("critter")) >>> 0`. Shuffles grid
  slots, tries up to `maxAttemptsPerSlot` jittered candidates per slot,
  rejects on corridor/spawn/bounds/slope gates. Stops at `count`.
- `critterPose(p, t, out?)` — pure orbit pose for a `PlacedCritter` at time
  `t`: position is the anchor offset by an inclined circular orbit plus a
  sinusoidal altitude bob; `yaw` faces tangent to the orbit. Deterministic.
- `defaultCritterOptions(seed)` — defaults: worldHalfExtent 100, cell 6,
  maxSlope 35deg, count 24, skyFraction 0.6.

Two bands: `"sky"` (high altitude, larger orbits) and `"ground"` (low
altitude, smaller orbits). Sky fraction determines the split.

`PlacedCritter` holds anchor position, orbit radius/speed/phase/tilt, bob
amplitude/frequency, scale, seed, and band.

# Wildlife.ts

InstancedMesh GL owner. One flat-shaded `CelMaterial` InstancedMesh of
low-poly bird silhouettes on layer 0.

- `constructor(terrain, opts)` — if `opts.kinds` is an empty array, opts out
  entirely (empty group, zero cost). Otherwise calls `placeCritters` and
  creates a bird InstancedMesh.
- `update(_dt, time)` — recomputes every instance matrix as a pure fn of
  absolute `time` via `critterPose`. `dt` is unused (deterministic replay).
- `dispose()` — frees GL resources; idempotent.

No outline (same instance-matrix limitation as Clouds/decor). No shadows.

# Biome Wiring

`WildlifeOptions.kinds` is a `readonly string[]`. An empty array opts the
biome out of wildlife entirely. Undefined or non-empty builds the default
birds (only `"birds"` renders now; multi-kind dispatch is forward work).

# Cross-References

- [Dressing](/environment/dressing.md)
- [propSampler](/environment/prop-sampler.md)
- [Environment Cascade](/environment/cascade.md)
