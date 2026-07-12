---
type: Subsystem
title: Flora Archetypes
description: Parameterized flora builders and string-keyed registry for biome dressing
tags: [environment, flora, dressing]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Two layers: a parameterized archetype library under `src/environment/flora/`
and a string-keyed registry in `floraRegistry.ts`. Each biome flora module
(`flora.ts` inside its `src/environment/biomes/<id>/` dir) calls `registerFlora` at
import time to wire its kinds.

The library is split into family modules; `src/environment/flora/archetypes.ts`
is the stable barrel biome modules import from:

- `src/environment/flora/trees.ts` — `coniferTree`, `canopyTree`,
  `branchingTree`, `snagTree`
- `src/environment/flora/rocks.ts` — `ballRock`
- `src/environment/flora/shrubs.ts` — `lumpyShrub`
- `src/environment/flora/groundcover.ts` — `groundDecor`

# Archetypes

All geometry is authored base-at-y=0 (PropField places the origin at terrain
height), deterministic from seed, and WebGL-free (jsdom-testable).

Each builder takes a config of knobs and returns a `FloraBuilder`:

```ts
interface FloraBuilder {
  build(seed: number): BuiltProp;
  big: boolean;
  collider: FloraCollider;
  cluster?: { radius: number; perCluster: number };
}
```

`cluster` (optional) makes the sampler place this kind in groves of
`perCluster` within `radius` metres of each accepted anchor instead of the
default uniform jittered-grid scatter. It is a property of the kind (how it
grows), declared at registration and threaded onto the sampler `PropLayer` by
`Environment.buildDressingConfig` / `PropField.buildSamplerOptions`; biome
`FloraEntry` data is unchanged. Undefined = uniform scatter (legacy path,
byte-identical for every layer that does not set it).

Seven parameterized builders:

| Builder         | Shape          | Big | Collider             | Tri budget |
| --------------- | -------------- | --- | -------------------- | ---------- |
| `coniferTree`   | Stacked-cone   | Yes | Cylinder             | <= 600     |
| `canopyTree`    | Canopy+lumps   | Yes | Cylinder             | <= 600     |
| `branchingTree` | Limbs+crown    | Yes | Cylinder             | <= 600     |
| `snagTree`      | Bare dead tree | Yes | Cylinder             | <= 600     |
| `ballRock`      | Noisy dodeca   | Yes | Ball (shares radius) | <= 600     |
| `lumpyShrub`    | Squashed ico   | No  | None                 | <= 60      |
| `groundDecor`   | Blade/petal    | No  | None                 | <= 60      |

Per-seed height: every tree config accepts `trunkHRange` (a `[min, max)`
tuple) so a stand carries real height variation instead of one cloned
silhouette. When set, the trunk height is the FIRST RNG draw; when unset the
fixed `trunkH` keeps the pre-knob draw sequence byte-identical. The static
collider uses the range midpoint (colliders are per-kind; only the lower
trunk matters for kart impacts).

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

## branchingTree(config?)

Broadleaf with visible limb structure: tapered trunk + per-seed limbs
(`limbCounts` [2,3,3]) reaching outward-up via a p0->p1 limb cylinder, each
tipped with a foliage lump, under a wide multi-lump crown (`crownCounts`
[3,4]). What separates it from `canopyTree` is the limbs — the crown breaks
out of a single blob and reads as a real branching tree at distance. Config:
`trunkH` (7) / `trunkHRange`, `trunkRadius` (0.6), `limbLen` (2.4), `canopyR`
(3.2), `foliage`, `trunkColor`. Cylinder collider:
`halfHeight = trunkH * 0.45`, `radius = trunkRadius * 1.3`.

## snagTree(config?)

Bare weathered dead tree: hard-tapered trunk (top ~0.25x, storm-broken spire
read) + 2-3 thin bare limbs kinked upward, no foliage, single weathered
color. Punctuation between living trees so a stand reads as a place with
history. Config: `trunkH` (6) / `trunkHRange`, `trunkRadius` (0.4),
`limbCounts` ([2,3]), `color` (0x8a7a68). Cylinder collider:
`halfHeight = trunkH * 0.5`, `radius = trunkRadius * 1.5`.

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

Config: `mode` (`"blade"`), `h` (0.5), `w` (0.08 blade width; wide values
give a broadleaf-plant read), `count` (3 blade / 1 petal), `palette`,
`stemColor`. Shared template, no collider.

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
registerFlora("bush", {
  build: buildBush,
  big: false,
  collider: { shape: "none" },
});
registerFlora("flower", {
  build: buildFlower,
  big: false,
  collider: { shape: "none" },
});
registerFlora("grass", {
  build: buildGrass,
  big: false,
  collider: { shape: "none" },
});
```

Archetype-based biomes use `coniferTree({...})`/`canopyTree({...})` etc.
directly. Overriding: spread the archetype result + replace the `collider`
field with a bespoke object (e.g. a custom halfHeight for a taller trunk).

# Bespoke tropical builders

`tropical.ts` mixes archetypes with bespoke builders for shapes no knob
expresses. 6 kinds, warm sun-bleached palette aligned to the tropical
terrain grass (0x8fae5a) + warm rock so props belong to the golden-hour shore:

- `palm` (big, bespoke): root flare + curved leaning trunk (4 segments along
  a quadratic offset curve) + crown knuckle + 2-3 coconuts + 6-9 flattened-
  cone fronds splayed/drooping radially. Trunk height, lean direction/amount,
  crown scale, and frond count/tilt vary per seed so a grove reads as distinct
  trees, not clones. Placed in groves (`cluster: { radius: 4.5, perCluster: 3 }`)
  so the shore reads as clustered beach palms. Cylinder collider pinned to the
  lower trunk (the curve's quadratic offset keeps the lower 4 m inside the base
  radius; the leaning crown sits above kart height).
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

# Tundra builders (027)

`tundra.ts` builds 3 cold-palette kinds entirely on the parameterized
archetypes (proof the kit reproduces a shipped biome). Pine uses
`coniferTree` with a snow-capped tier; iceRock uses `ballRock`; snowBush
uses `lumpyShrub`. The pine collider is pinned to the bespoke tundra
contract (`halfHeight` 2.5 + `radius` 0.8) rather than the archetype's
trunk-derived heuristic. `iceRockRadius(seed)` delegates to the ballRock
radius fn so the visual + Rapier ball collider share the first RNG draw.

| Kind       | Builder     | Big | Collider                        |
| ---------- | ----------- | --- | ------------------------------- |
| `pine`     | coniferTree | Yes | Cylinder (bespoke hh 2.5 r 0.8) |
| `iceRock`  | ballRock    | Yes | Ball (`iceRockRadius`)          |
| `snowBush` | lumpyShrub  | No  | None                            |

# Alpine builders (028)

`alpine.ts` builds 3 granite-palette kinds with bespoke geometry
(per-instance merged, unique by seed). alpinePine is a tall spire
(8 m trunk + tapering cone tiers); screeRock is a noisy dodecahedron;
lichenBush is a small flat squashed icosahedron. `screeRockRadius(seed)`
shares the first RNG draw with the visual so the ball collider tracks
visible bulk (PropField.createBody parity).

| Kind         | Builder | Big | Collider                              |
| ------------ | ------- | --- | ------------------------------------- |
| `alpinePine` | bespoke | Yes | Cylinder (hh 4, r 0.8)                |
| `screeRock`  | bespoke | Yes | Ball (`screeRockRadius`, `ROCK_BURY`) |
| `lichenBush` | bespoke | No  | None                                  |

# Desert builders (026)

`desert.ts` builds 4 warm-palette kinds. Cactus is a bespoke merged
column + 1-2 splayed arms; sandRock is a bespoke noisy dodecahedron;
yucca is shared crossed spike blades; dryShrub is a shared squashed
icosahedron. `sandRockRadius(seed)` shares the first RNG draw with the
visual for ball-collider parity (PropField.createBody).

| Kind       | Builder | Big | Collider                             |
| ---------- | ------- | --- | ------------------------------------ |
| `cactus`   | bespoke | Yes | Cylinder (hh 2.0, r 0.5)             |
| `sandRock` | bespoke | Yes | Ball (`sandRockRadius`, `ROCK_BURY`) |
| `yucca`    | bespoke | No  | None                                 |
| `dryShrub` | bespoke | No  | None                                 |

# Cross-References

- [Dressing](/environment/dressing.md)
- [PropFactory](/environment/prop-factory.md)
- [Biomes](/biomes/framework.md)
