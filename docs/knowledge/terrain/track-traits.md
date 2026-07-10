---
type: Subsystem
title: Track Traits
description: >
  Per-biome track character: width band, width variation, branch chance, and
  branch bias. Biomes carry only overrides; undefined fields fall back to
  the temperate parity baseline.
tags: [terrain, circuit, biome]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

`src/terrain/trackTraits.ts` is pure data: a biome (or any caller) describes
how its roads should feel — width band, how much the width breathes along
the lap, how often the circuit forks, and which fork kind the biome favors.
`generateCircuit` consumes the resolved traits; biomes carry only overrides
(undefined = defaults, mirroring the BiomeDefinition terrain override
pattern).

## TrackTraits Interface

| Field            | Type     | Meaning                                                      |
| ---------------- | -------- | ------------------------------------------------------------ |
| `widthMin`       | `number` | Narrowest corridor half-width the generator may emit (m)     |
| `widthMax`       | `number` | Widest corridor half-width the generator may emit (m)        |
| `widthVariation` | `number` | 0..1: how strongly width swings across its [min, max] band   |
| `branchChance`   | `number` | Expected branches per circuit (0..2). Integer part =         |
|                  |          | guaranteed attempts; fraction = probability of one more      |
| `branchBias`     | union    | Fork-kind preference: `"shortcut"`, `"scenic"`, `"balanced"` |

## DEFAULT_TRACK_TRAITS

The temperate parity baseline:

| Field            | Value        |
| ---------------- | ------------ |
| `widthMin`       | `4.5`        |
| `widthMax`       | `9`          |
| `widthVariation` | `0.6`        |
| `branchChance`   | `0.7`        |
| `branchBias`     | `"balanced"` |

## resolveTrackTraits(overrides?)

Merges trait overrides over the defaults (`{ ...DEFAULT_TRACK_TRAITS,
...overrides }`), then enforces sanity:

- `widthMax` floored at 6 m so the 2-column start grid (lateral 2.0 m
  straddle) always fits the start-zone width floor
- `widthMin` clamped to `<= widthMax`
- `widthVariation` clamped to `[0, 1]`
- `branchChance` clamped to `[0, 2]`

## Circuit Consumption

`generateCircuit` in `src/terrain/circuit.ts` accepts resolved traits as
its second parameter (defaulting to `DEFAULT_TRACK_TRAITS`). The width
profile draw (`generateWidthProfile`) and branch generation
(`generateBranches`) are driven entirely by these traits, and both are
independent of the mainline attempt loop — so taming (which redraws the
centerline shape as attempts mount) never changes the width character of
a seed. See [Circuits](/terrain/circuits.md) and
[Circuit Branches and Width](/terrain/circuit-branches.md).

## Biome Overrides

A `BiomeDefinition.track` field carries `Readonly<Partial<TrackTraits>>`:
only the overrides. Undefined fields resolve to `DEFAULT_TRACK_TRAITS`,
mirroring the `terrain` override pattern
(`biomeTerrain` merges over `DEFAULT_TERRAIN_CONFIG`). See
[Biomes](/terrain/biomes.md).

| Biome     | widthMin | widthMax | widthVariation | branchChance | branchBias |
| --------- | -------- | -------- | -------------- | ------------ | ---------- |
| temperate | 4.5      | 9        | 0.6            | 0.7          | balanced   |
| desert    | 6        | 9        | 0.35           | 0.5          | scenic     |
| alpine    | 4.5      | 7        | 0.85           | 0.9          | shortcut   |
| tundra    | 5.5      | 8.5      | 0.45           | 0.35         | balanced   |
| tropical  | 4.5      | 7.5      | 0.9            | 1.2          | balanced   |

Temperate carries no `track` override (pure defaults). Tundra and tropical
omit `branchBias`, so it resolves to the default `"balanced"`.

# Citations

- [Circuits](/terrain/circuits.md)
- [Circuit Branches and Width](/terrain/circuit-branches.md)
- [Biomes](/terrain/biomes.md)
