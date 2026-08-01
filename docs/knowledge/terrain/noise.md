---
type: Subsystem
title: Noise
description: "Seeded 2D simplex noise for terrain field hills, deterministic and WebGL-free."
tags: [terrain, noise, procedural]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`src/terrain/noise.ts` implements Gustavson simplex noise in 2D as a
pure, deterministic, WebGL-free class — runs under jsdom. Output range
approximately [-1, 1].

## SimplexNoise2D

```ts
class SimplexNoise2D {
  constructor(seed?: number); // default 1337
  noise(xin: number, yin: number): number;
}
```

Internals:

- `mulberry32` PRNG seeds a Fisher-Yates shuffle of a 256-entry permutation
  table.
- 12 gradient directions (`GRAD3`) with unused Z for 2D.
- Standard simplex skew/unskew: `F2 = 0.5*(sqrt(3)-1)`, `G2 = (3-sqrt(3))/6`.
- The same `seed` always reproduces the same noise field (deterministic).

## Role in Height Pipeline

`SimplexNoise2D` is one of three inputs to `heightAt(x, z)`, alongside
`SplineFieldCache` and `TerrainConfig`. The noise adds field hills as
variation over the base spline surface. Config knobs on `TerrainConfig`:

| Knob           | Role                                     |
| -------------- | ---------------------------------------- |
| `noiseAmp`     | Amplitude (vertical scale)               |
| `noiseFreq`    | Frequency (horizontal feature size)      |
| `noiseOctaves` | Octave count for layered detail          |
| `noiseSeed`    | Seed fed to `SimplexNoise2D` constructor |

The noise seed is per-circuit, not per-biome: `Game.buildWorld` sets
`TerrainConfig.noiseSeed = (hashSeed("terrain") ^ id.seed) >>> 0` after
`biomeTerrain` resolves the biome terrain overrides, so each circuit seed
produces a distinct, deterministic surface (see
[Height Pipeline](height-pipeline.md) relief-seed section). `biomeTerrain`
does not override `noiseSeed`.

## TerrainConfig

`DEFAULT_TERRAIN_CONFIG` provides baseline noise settings; biomes override
individual knobs. Tests isolate the spline base inline
(`{ ...DEFAULT_TERRAIN_CONFIG, noiseAmp: 0 }`) rather than via a named
fixture.

## See Also

- [Height Pipeline](height-pipeline.md) — `heightAt` composition and `HeightSource`
