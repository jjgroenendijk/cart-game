---
type: Subsystem
title: PropFactory
description: Shared prop geometry/material assembly plumbing for all flora kinds
tags: [environment, dressing, props]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`propFactory.ts` provides the geometry/material assembly plumbing every flora
kind reuses. WebGL-free-pure-friendly (no side effects beyond three.js).

# API

## BuiltProp

```ts
export interface BuiltProp {
  geometry: THREE.BufferGeometry;
  material: CelMaterial;
  dispose(): void;
}
```

The return type of flora builders. Wraps a `BufferGeometry` and
`CelMaterial` with a joint dispose.

## buildOnce

```ts
buildOnce(makeGeo: () => BufferGeometry, celOpts): BuiltProp
```

Builds the geometry, wraps it in flat-shaded `CelMaterial`. Returns a
`BuiltProp` with a dispose fn that frees both. Used by every flora builder.

## mergeOrFirst

```ts
mergeOrFirst(parts: BufferGeometry[]): BufferGeometry
```

Merges part geometries into one via `mergeGeometries`. If only one part,
returns it directly. Disposes all inputs on merge. Throws if
`mergeGeometries` returns null.

## prepPart

```ts
prepPart(geo: BufferGeometry, hex: number): BufferGeometry
```

Normalizes a geometry for merging: flattens to non-indexed, drops `uv`
(props are untextured), bakes a uniform LINEAR color attribute from the sRGB
hex. Returns the part to use (may be a new geometry when de-indexed).

## ROCK_BURY

```ts
export const ROCK_BURY = 0.3;
```

Fraction of the rock radius buried below the placement origin. A noisy
dodecahedron rests on a single displaced corner; sinking the bulk makes it
read as grounded. Shared by the temperate rock visual builder and the Rapier
ball collider so the collider tracks the visible bulk.

## rockRadius

```ts
rockRadius(seed: number): number
```

Single source of truth for rock collision radius. Converts `seed` to RNG,
draws `range(0.9, 1.8)`. The flora builder's visual and `PropField`'s ball
collider both pull from this so the collider tracks the visible rock.

# Cross-References

- [Dressing](/environment/dressing.md)
- [Flora Archetypes](/environment/flora-archetypes.md)
