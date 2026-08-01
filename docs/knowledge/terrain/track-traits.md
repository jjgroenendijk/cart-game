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

| Field              | Type     | Meaning                                                      |
| ------------------ | -------- | ------------------------------------------------------------ |
| `widthMin`         | `number` | Narrowest corridor half-width the generator may emit (m)     |
| `widthMax`         | `number` | Widest corridor half-width the generator may emit (m)        |
| `widthVariation`   | `number` | 0..1: how strongly width swings across its [min, max] band   |
| `branchChance`     | `number` | Expected branches per circuit (0..2). Integer part =         |
|                    |          | guaranteed attempts; fraction = probability of one more      |
| `branchBias`       | union    | Fork-kind preference: `"shortcut"`, `"scenic"`, `"balanced"` |
| `archetypeWeights` | record   | Relative weights for the per-seed `LayoutArchetype` draw;    |
|                    |          | missing keys resolve to 1, all-zero falls back to default    |
| `elevationScale`   | `number` | 0.25..2 multiplier on the elevation amplitude (per biome),   |
|                    |          | multiplied with the archetype's own elevation scale          |
| `hillBias`         | `number` | 0..1 weight of a guaranteed 1-cycle climb/descent per lap    |
| `bankMax`          | `number` | Max corner bank angle (rad; default 10 deg, ceiling 12 deg,  |
|                    |          | 0 = level roads). See [banking](/terrain/circuit-banking.md) |

## DEFAULT_TRACK_TRAITS

The temperate parity baseline:

| Field              | Value                              |
| ------------------ | ---------------------------------- |
| `widthMin`         | `4.5`                              |
| `widthMax`         | `9`                                |
| `widthVariation`   | `0.6`                              |
| `branchChance`     | `0.7`                              |
| `branchBias`       | `"balanced"`                       |
| `archetypeWeights` | technical 1.8, power 0.7, others 1 |
| `elevationScale`   | `1`                                |
| `hillBias`         | `0`                                |

## resolveTrackTraits(overrides?)

Merges trait overrides over the defaults (`{ ...DEFAULT_TRACK_TRAITS,
...overrides }`), then enforces sanity:

- `widthMax` floored at 6 m so the 2-column start grid (lateral 2.0 m
  straddle) always fits the start-zone width floor
- `widthMin` clamped to `<= widthMax`
- `widthVariation` clamped to `[0, 1]`
- `branchChance` clamped to `[0, 2]`
- `elevationScale` clamped to `[0.25, 2]`, `hillBias` to `[0, 1]`
- `archetypeWeights` filled per archetype (missing key -> 1), negatives
  clamped to 0; an all-zero record falls back to the default archetype
  weights (`DEFAULT_TRACK_TRAITS.archetypeWeights`, tech-leaning)

## Circuit Consumption

`generateCircuit` in `src/terrain/circuit.ts` accepts resolved traits as
its second parameter (defaulting to `DEFAULT_TRACK_TRAITS`). The width
profile draw (`generateWidthProfile`) and branch generation
(`generateBranches`) are driven by these traits. The random width
harmonics and branch draws are seed-only, but the width choreography
(wide corner entry, apex pinch) follows the curvature of the ACCEPTED
centerline, so a taming retry re-choreographs the width to the new
geometry. See [Circuits](/terrain/circuits.md) and
[Circuit Branches and Width](/terrain/circuit-branches.md).

## Biome Overrides

A `BiomeDefinition.track` field carries `Readonly<Partial<TrackTraits>>`:
only the overrides. Undefined fields resolve to `DEFAULT_TRACK_TRAITS`,
mirroring the `terrain` override pattern
(`biomeTerrain` merges over `DEFAULT_TERRAIN_CONFIG`). See
[Biomes](/biomes/framework.md).

| Biome         | width band | variation | branch     | elevScale | hillBias |
| ------------- | ---------- | --------- | ---------- | --------- | -------- |
| temperate     | 4.5-9      | 0.6       | 0.7 bal    | 1         | 0        |
| desert        | 6-10.5     | 0.5       | 0.5 scenic | 0.6       | 0        |
| alpine        | 4-6.5      | 0.9       | 0.9 short  | 1.7       | 0.6      |
| tundra        | 5.5-9      | 0.45      | 0.35 bal   | 0.9       | 0        |
| tropical      | 4.5-8      | 1.0       | 1.2 bal    | 1.1       | 0        |
| autumn        | 5-8.5      | 0.7       | 0.9 bal    | 1.0       | 0        |
| badlands      | 5-8.5      | 0.7       | 0.7 bal    | 0.9       | 0        |
| beach         | 5.5-10     | 0.4       | 0.4 scenic | 0.7       | 0        |
| mediterranean | 4.5-9      | 0.5       | 0.6 scenic | 1.15      | 0.4      |

`archetypeWeights` overrides (classic stays 1 except mediterranean 1.2):
desert flow 1.5 power 1.5; alpine flow 0.5 technical 3 power 0; tundra
flow 2.5; tropical flow 1.5 technical 2.5 power 0.5; autumn flow 2
technical 2 power 0.5; badlands technical 1.5; beach flow 2.5 technical
0.5 power 1.5; mediterranean classic 1.2 flow 2 technical 0.8. Temperate
uses pure defaults.

Temperate carries no `track` override (pure defaults). Temperate, tundra,
tropical, and autumn omit `branchBias`, so it resolves to the default
`"balanced"` (badlands sets `"balanced"` explicitly). The intent:
desert reads as wide near-flat power highways, alpine as narrow hairpin
hillclimbs, tundra as broad flowing sweepers, tropical as restless twisty
trails.

# Citations

- [Circuits](/terrain/circuits.md)
- [Circuit Branches and Width](/terrain/circuit-branches.md)
- [Biomes](/biomes/framework.md)
