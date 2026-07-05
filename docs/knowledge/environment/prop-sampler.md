---
type: Subsystem
title: PropSampler
description: Deterministic prop placement from seeded RNG via jittered-grid rejection sampling
tags: [environment, dressing, props]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Two sampling functions: world-space `sampleProps` and per-chunk
`sampleChunkProps`. Both are pure (no WebGL/physics/THREE geometry),
jsdom-testable.

# World Sampling

```ts
sampleProps(terrain: SamplerTerrain, opts: SamplerOptions): PlacedProp[]
```

Deterministic jittered-grid sampler over the full world extent. For each
`PropLayer` it sub-seeds an RNG with `(opts.seed ^ hashSeed(layer.kind))

> > > 0`, shuffles grid slots via Fisher-Yates, then tries up to
`maxAttemptsPerSlot` jittered candidates per slot. Accepts the first that
> > > clears:

- **Corridor**: spline distance >= `trackHalfWidth + corridorMargin`
- **Spawn**: outside `spawnExclusionRadius` of `startPos`
- **Bounds**: within `worldHalfExtent - edgeMargin`
- **Slope**: surface tilt <= the layer's `maxSlope`

Same seed + same terrain -> identical placement every run.

# Per-Chunk Sampling

```ts
sampleChunkProps(gx, gz, rect, terrain, baseSeed, layers, opts): PlacedProp[]
```

Jittered grid over the chunk `rect` only. Per-chunk seed derivation:

```text
chunkSeed = (baseSeed ^ hashSeed(gx + "," + gz)) >>> 0
```

Each layer gets its own sub-seed (`^ hashSeed(layer.kind)`) so layers stay
independent. Re-activating the same chunk reproduces identical placement
(coordinate-stable). Corridor + spawn rejection still applies but is a
no-op far from the track (spline dist large -> passes).

`layer.count` is the target placements FOR THIS CHUNK (not total).

# Types

- `SamplerTerrain` — minimal terrain surface interface: `heightAt`,
  `normalAt`, `startPos`, `spline.closestPoint`, optional `heightMapField`
  and `waterLevel`.
- `PropLayer` — placement request: `kind`, `count`, `minScale`/`maxScale`,
  optional per-layer `maxSlope`.
- `PlacedProp` — resolved placement: position, surface normal, kind, seed,
  scale.
- `FloraKind` — plain string, resolved via flora registry at build time.

# Cross-References

- [Dressing](/environment/dressing.md)
- [PropFactory](/environment/prop-factory.md)
- [Flora Archetypes](/environment/flora-archetypes.md)
