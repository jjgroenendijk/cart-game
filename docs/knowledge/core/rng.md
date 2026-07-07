---
type: System
title: RNG
description: "Cross-cutting seeded PRNG (mulberry32) for deterministic placement."
tags: [core, rng, procedural, deterministic]
timestamp: 2026-07-07T00:00:00Z
---

# RNG

`src/core/rng.ts` is the canonical home for deterministic pseudo-randomness.
All output is a pure function of the seed: the same seed reproduces the same
sequence every run, so procedural placement (AI tuning, circuit shapes,
environment dressing, kart VFX) stays reproducible across runs.

## API

`mulberry32(seed)` is the underlying tiny 32-bit PRNG (seed coerced to uint32).
`makeRNG(seed)` returns an `RNG` with `next` ([0,1)), `range(min,max)`,
`unit` (signed [-1,1)), and `pick(arr)`. `hashSeed(str)` FNV-1a-hashes a string
label to a uint32 sub-seed so callers need not hand-pick integers. The small
math helpers `clamp01` and `smoothstep` live here too.

## Consumers

Seeds AI tunings and per-rival route decisions in FieldBuilder, circuit/race
generation, environment dressing, and kart VFX. The heightmap and noise modules
ship their own private copies of mulberry32 and the math helpers (they predate
this module); consolidating them onto here is a non-blocking cleanup note.

## Citations

- [FieldBuilder](/core/field-builder.md)
- [Game](/core/game.md)
