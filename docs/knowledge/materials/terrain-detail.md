---
type: Shader
title: Terrain Surface Detail
description: >
  Cheap value-noise fbm layered over near terrain to mottle LINEAR albedo
  and perturb the shading normal, behind the SURFACE_DETAIL define.
  Tier-gated (low off). Shading-only.
tags: [materials, shader, terrain, detail]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

`src/materials/terrainDetail.ts` layers cheap value-noise fbm over the
near terrain surface to (a) mottle the LINEAR albedo and (b) perturb the
shading normal with the fbm gradient. The module is pure: no Three.js,
no WebGL, no DOM — runs under jsdom. The JS `hash2`/`vnoise`/`fbm` mirror
the exported GLSL bit-for-bit so a unit test locks the algorithm; the
GLSL apply snippets are asserted by source-substring tests (no GPU in CI).

`src/materials/cel.ts` inlines these strings behind `SURFACE_DETAIL`; low
tier stays disabled by construction (byte-identical to pre-069).

## terrainDetailForTier(tier)

Tier-gating entry point:

| Tier | enabled | strength | scale | bump | octaves |
| ---- | ------- | -------- | ----- | ---- | ------- |
| low  | false   | 0        | 0     | 0    | 0       |
| med  | true    | 0.12     | 1.1   | 0.08 | 2       |
| high | true    | 0.16     | 1.1   | 0.12 | 3       |

`low` returns `{ enabled: false, ... }` with all params zeroed —
`SURFACE_DETAIL` is never defined, so the fragment is byte-identical to
pre-069 by construction.

## Pure JS Mirror Functions

`hash2(x, y)`, `vnoise(x, y)`, and `fbm(x, y, octaves)` mirror the GLSL
bit-for-bit. They exist so jsdom unit tests lock the noise algorithm
without a GPU:

- `hash2`: pseudo-random hash via `fract(sin(...))`, constant
  `HASH_C = 43758.5453123`
- `vnoise`: bilinear value noise — 4 lattice-corner hashes smoothed by
  the quintic `f^2 * (3 - 2f)` fade
- `fbm`: fractal sum of `vnoise` octaves with 0.5 amplitude decay and
  2x frequency doubling, normalized by accumulated amplitude

## GLSL Snippet Constants

Three exported string constants carry the GLSL body:

| Constant                | Role                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `DETAIL_NOISE_FN`       | GLSL `hash2` + `vnoise` + `fbm` (the noise primitives)           |
| `DETAIL_ALBEDO_SNIPPET` | Mottles LINEAR base: `base *= 1 + uDetailStrength * (fbm - 0.5)` |
| `DETAIL_NORMAL_SNIPPET` | Finite-diff fbm gradient perturbs `Nworld` before view map       |

`cel.ts` inlines these behind `SURFACE_DETAIL`:

- `DETAIL_NOISE_FN` is concatenated with `DETAIL_HEADER_PREFIX`
  (uniforms + `#define DETAIL_OCTAVES`) into the `#ifdef HEIGHT_MAP`
  header block
- `DETAIL_ALBEDO_SNIPPET` is wrapped in `#ifdef SURFACE_DETAIL ... #endif`
  and inserted after the vertex-color base multiply, before wetness
- `DETAIL_NORMAL_SNIPPET` is wrapped in `#ifdef SURFACE_DETAIL ... #endif`
  and inserted after the world-space heightmap normal, before the
  view-space map (`Nworld -> normalMatrix -> N`)

All detail GLSL is nested inside `#ifdef HEIGHT_MAP` (detail keys on
`vWorldXZ`) and requires `surfaceDetail && heightMap` to activate.

## DETAIL_DEFAULTS

| Field      | Value |
| ---------- | ----- |
| `strength` | 0.16  |
| `scale`    | 1.1   |
| `bump`     | 0.12  |
| `octaves`  | 3     |

## TerrainDetailParams

| Field      | Type      | Meaning                                           |
| ---------- | --------- | ------------------------------------------------- |
| `enabled`  | `boolean` | Whether the SURFACE_DETAIL branch is active       |
| `strength` | `number`  | Albedo mottle amplitude (multiplier on fbm - 0.5) |
| `scale`    | `number`  | fbm frequency scale (world XZ multiplier)         |
| `bump`     | `number`  | Normal perturbation strength                      |
| `octaves`  | `number`  | fbm octave count (baked as DETAIL_OCTAVES define) |

## Shading-Only Invariant

This is shading-only detail. `heightAt`, the trimesh collider, and
suspension raycasts are untouched; mesh and collider verts stay identical
by construction. See [Height Pipeline](/terrain/height-pipeline.md).

When disabled (low tier, or `surfaceDetail: false` / no `heightMap`), the
off-path fragment source is byte-identical to the pre-069 shader: no
`SURFACE_DETAIL` define, no `uDetail*` uniforms, no detail GLSL tokens.
The `low` quality tier keeps `SURFACE_DETAIL` disabled by construction via
`terrainDetailForTier("low")` returning `enabled: false`.

# Citations

- [CelMaterial](/materials/cel-material.md)
- [Height Pipeline](/terrain/height-pipeline.md)
- [Quality](/core/quality.md)
