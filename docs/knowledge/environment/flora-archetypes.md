---
type: Subsystem
title: Flora Archetypes
description: Parameterized flora builders and string-keyed registry for biome dressing
tags: [environment, flora, dressing]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Two layers: five parameterized archetype builders in `flora/archetypes.ts`
and a string-keyed registry in `floraRegistry.ts`. Each biome module calls
`registerFlora` at import time to wire its kinds.

# Archetypes

All geometry is authored base-at-y=0 (PropField places the origin at terrain
height), deterministic from seed, and WebGL-free (jsdom-testable).

Each builder takes a config of knobs and returns a `FloraBuilder`:

```ts
interface FloraBuilder {
  build(seed: number): BuiltProp;
  big: boolean;
  collider: FloraCollider;
}
```

Five parameterized builders:

| Builder       | Shape        | Big | Collider             | Tri budget |
| ------------- | ------------ | --- | -------------------- | ---------- |
| `coniferTree` | Stacked-cone | Yes | Cylinder             | <= 600     |
| `canopyTree`  | Canopy+lumps | Yes | Cylinder             | <= 600     |
| `ballRock`    | Noisy dodeca | Yes | Ball (shares radius) | <= 600     |
| `lumpyShrub`  | Squashed ico | No  | None                 | <= 60      |
| `groundDecor` | Blade/petal  | No  | None                 | <= 60      |

## coniferTree(config?)

Stacked cone spire (fir/spruce/pine). Trunk cylinder + tapering cone tiers
overlapping upward. Config: `trunkH` (8), `trunkRadius` (0.5), `tiers` (4)
or `tierCounts` (per-seed pick array), `tierRadius` (2.6), `tierH` (3.2),
`foliage` palette, `trunkColor`, optional `capColor` for top-tier snow-laden
crown. Cylinder collider: `halfHeight = trunkH * 0.5`, `radius = trunkRadius * 1.5`.

## canopyTree(config?)

Canopy-on-trunk broadleaf. Trunk cylinder + stacked icosahedron lumps
shrinking upward, each randomly offset and palette-picked. Config: `trunkH`
(4), `trunkRadius` (0.55), `lobes` (3) or `lobeCounts` (per-seed pick
array), `canopyR` (2.4), `foliage` palette, `trunkColor`, `jitter` (0.5).
Cylinder collider: `halfHeight = trunkH * 0.4`, `radius = trunkRadius * 1.1`.

## ballRock(config?)

Noisy dodecahedron rock. Per-corner displacement keyed on quantized base
position so shared corners stay together (closed surface). Sinks below
origin by `-minY - r * ROCK_BURY` so the rock embeds into the ground.
Config: `rMin`/`rMax` (0.9-1.8), `color`, `flatten` (optional y-scale for
flagstone reads). Ball collider: `radius(seed)` function draws the same
first RNG value as the visual, so collider tracks visible bulk. `bury`
defaults to `ROCK_BURY`.

## lumpyShrub(config?)

Squashed icosahedron shrub. Decor: shared template, ignores seed for
InstancedMesh. Config: `r` (0.9), `squashY` (0.7), `color` (0x4f7a3a),
`yOffset` (0.45). No collider.

## groundDecor(config?)

Flat ground decor. Two modes:

- `"blade"` — crossed PlaneGeometry blades (grass), rotated around Y
- `"petal"` — stem cylinder + icosahedron petal blobs (flower)

Config: `mode` (`"blade"`), `h` (0.5), `count` (3 blade / 1 petal),
`palette`, `stemColor`. Shared template, no collider.

# Flora Registry

`floraRegistry.ts` provides a string-keyed `FloraKind` map:

- `registerFlora(kind, builder)` — register a kind. Idempotent (re-import
  safe).
- `floraFor(kind)` — lookup a kind; throws clear Error if unregistered.
- `isRegisteredFlora(kind)` — presence check.
- `registeredFloraKinds()` — all registered kinds in insertion order.

`FloraCollider` union:

```ts
{ shape: "cylinder"; halfHeight: number; radius: number }
| { shape: "ball"; radius: (seed: number) => number; bury?: number }
| { shape: "none" }
```

# Registry Wiring

Each biome module calls `registerFlora` at import time. Temperate registers
five legacy kinds using the original bespoke builders (byte-identical to
pre-refactor):

```ts
registerFlora("tree", {
  build: buildTree,
  big: true,
  collider: { shape: "cylinder", halfHeight: 1.5, radius: 0.6 },
});
registerFlora("rock", {
  build: buildRock,
  big: true,
  collider: { shape: "ball", radius: rockRadius, bury: ROCK_BURY },
});
registerFlora("bush", { build: buildBush, big: false, collider: { shape: "none" } });
registerFlora("flower", { build: buildFlower, big: false, collider: { shape: "none" } });
registerFlora("grass", { build: buildGrass, big: false, collider: { shape: "none" } });
```

Archetype-based biomes use `coniferTree({...})`/`canopyTree({...})` etc.
directly. Overriding: spread the archetype result + replace the `collider`
field with a bespoke object (e.g. a custom halfHeight for a taller trunk).

# Bespoke tropical builders (073)

`tropical.ts` mixes archetypes with bespoke builders for shapes no knob
expresses. 6 kinds, warm sun-bleached palette aligned to the 073 terrain
grass (0x8fae5a) + warm rock so props belong to the golden-hour shore:

- `palm` (big, bespoke): root flare + tall trunk + crown knuckle + 2-3
  coconuts + 5-7 flattened-cone fronds splayed/drooping radially. Cylinder
  collider pinned to the trunk (crown is above kart height).
- `jungleRock` (big, `ballRock`): warm earthy dodeca; ball collider shares
  the radius RNG draw.
- `fernShrub` (decor, bespoke): warm frond blades fanning around a centre
  blade (reads as a fern clump, not a blob).
- `tropicalFlower` (decor, `groundDecor` petal): hot coral/amber 2-petal
  ground bloom.
- `seaOats` (decor, bespoke): tall tan stalks + golden seed-heads (dune
  grass). The head is splayed with the same tilt+azimuth as its stalk so it
  lands at the stalk tip.
- `hibiscus` (decor, bespoke): low leafy mound + 2 hot blooms.

Decor tri budgets intentionally exceed the <=60 archetype guideline for the
bespoke clumps (richer shore read); draw calls stay 1/kind via InstancedMesh.

# Cross-References

- [Dressing](/environment/dressing.md)
- [PropFactory](/environment/prop-factory.md)
- [Biomes](/terrain/biomes.md)
