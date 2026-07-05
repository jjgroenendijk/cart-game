---
type: Subsystem
title: Dressing
description: "Procedural prop placement: flora registry, deterministic sampling, Rapier colliders."
tags: [environment, props, flora, dressing]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Procedural world dressing via flora registry and prop sampling.

## Flora Registry

`floraRegistry.ts`: string-keyed `FloraKind` map. Five archetypes from
`flora/archetypes.ts`:

| Archetype    | Kind        |
| ------------ | ----------- |
| Conifer tree | coniferTree |
| Canopy tree  | canopyTree  |
| Ball rock    | ballRock    |
| Lumpy shrub  | lumpyShrub  |
| Ground decor | groundDecor |

Each biome registers its kinds via:

```ts
registerFlora(kind, { build, big, collider });
```

## Prop Sampling

`propSampler` provides deterministic placement from seeded RNG.
Per-chunk seed: `(baseSeed ^ hashSeed(gx + "," + gz)) >>> 0`, where
`hashSeed` takes a single comma-separated string argument. The `>>> 0`
forces unsigned 32-bit.

`PropField` owns prop Rapier bodies; kind-agnostic via `floraFor(kind)`.
`dispose()` required for cleanup.

Props placed at raw terrain height (geometry base-at-y=0). Rock visual
radius and collider share `rockRadius(seed)`.

## Chunk Streaming

`DressingChunkManager` (023) streams per-chunk `PropField` bundles driven by
camera focus. Activate/deactivate + dispose cascade.

Big props (tree/rock) merge into spatial buckets; Rapier colliders stay
per-prop. `MAX_BIG_PROPS_PER_CHUNK = 8`.

## Wildlife

`critters.ts`: pure wildlife placement + orbit pose, WebGL-free. Wildlife
InstancedMesh owns GL rendering.

# Cross-References

- [Biomes](/terrain/biomes.md)
- [Chunk Streaming](/terrain/chunk-streaming.md)
- [KartController](/kart/controller.md)
