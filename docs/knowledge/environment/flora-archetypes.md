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
  flatShading?: boolean;
}
```

`flatShading` (defaults false) drives the CelMaterial `flatShading` opt:
true = per-face normals (faceted rock/stone read), absent = smooth
interpolated (organic foliage). Only rock kinds set it.

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

Each biome module calls `registerFlora` at import time. Archetype-based
biomes use `coniferTree({...})`/`canopyTree({...})` etc. directly.
Overriding: spread the archetype result + replace the `collider` field with
a bespoke object (e.g. a custom halfHeight for a taller trunk).

# Temperate builders

`temperate/flora.ts` registers EIGHT kinds: three archetype-built big trees
(tree/birch/forestPine), a bespoke rock, and four shared-template decor
kinds. The big trees carry per-seed `trunkHRange` so a stand reads as
individual trees, not clones:

- `tree` -> `branchingTree` (big oak, visible limbs + wide crown,
  `trunkHRange:[6.5,9]`). Registered directly as the archetype instance.
- `birch` -> `canopyTree` (slim pale trunk + small bright canopy,
  `trunkHRange:[7,9.5]`).
- `forestPine` -> `coniferTree` (dark spire breaking the broadleaf line,
  `trunkHRange:[10,13]`).
- `rock` -> bespoke noisy dodecahedron; ball collider via `rockRadius` +
  `ROCK_BURY`, `flatShading:true`.
- `bush`/`flower`/`grass` -> bespoke shared-template decor (squashed ico /
  stem+petal / crossed blades), no collider.
- `tallGrass` -> `groundDecor` blade (knee-high straw tufts), no collider.

| Kind         | Builder       | Big | Collider                         |
| ------------ | ------------- | --- | -------------------------------- |
| `tree`       | branchingTree | Yes | Cylinder (hh 3.49, r 1.04)       |
| `birch`      | canopyTree    | Yes | Cylinder (hh 3.3, r 0.42)        |
| `forestPine` | coniferTree   | Yes | Cylinder (hh 5.75, r 0.83)       |
| `rock`       | bespoke       | Yes | Ball (`rockRadius`, `ROCK_BURY`) |
| `bush`       | bespoke       | No  | None                             |
| `flower`     | bespoke       | No  | None                             |
| `grass`      | bespoke       | No  | None                             |
| `tallGrass`  | groundDecor   | No  | None                             |

# Bespoke tropical builders

`tropical/flora.ts` mixes archetypes with bespoke builders for shapes no knob
expresses. 8 kinds, warm sun-bleached palette aligned to the tropical
terrain grass (0x8fae5a) + warm rock so props belong to the golden-hour shore:

- `palm` (big, bespoke): root flare + curved leaning trunk (4 segments along
  a quadratic offset curve) + crown knuckle + 2-3 coconuts + 6-9 flattened-
  cone fronds splayed/drooping radially. Trunk height, lean direction/amount,
  crown scale, and frond count/tilt vary per seed so a grove reads as distinct
  trees, not clones. Placed in groves (`cluster: { radius: 4.5, perCluster: 3 }`)
  so the shore reads as clustered beach palms. Cylinder collider pinned to the
  lower trunk (the curve's quadratic offset keeps the lower 4 m inside the base
  radius; the leaning crown sits above kart height).
- `kapok` (big, `branchingTree`): jungle giant anchoring the treeline — visible
  limbs each carrying a foliage mass under a wide crown (`trunkHRange:[9,12]`).
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
- `broadleaf` (decor, `groundDecor` blade): banana-like wide blades between
  the palms.

Decor tri budgets intentionally exceed the <=60 archetype guideline for the
bespoke clumps (richer shore read); draw calls stay 1/kind via InstancedMesh.

# Tundra builders (027)

`tundra/flora.ts` builds 6 cold-palette kinds entirely on the parameterized
archetypes (proof the kit reproduces a shipped biome). Pine uses
`coniferTree` with a snow-capped tier (`capColor`); deadSpruce uses
`snagTree`; erratic + iceRock use `ballRock`; snowBush uses `lumpyShrub`;
frostTuft uses `groundDecor`. The pine collider is pinned to the bespoke
tundra contract (`halfHeight` 4.5 + `radius` 0.9) rather than the
archetype's trunk-derived heuristic. `iceRockRadius(seed)` delegates to the
ballRock radius fn so the visual + Rapier ball collider share the first RNG
draw.

| Kind         | Builder     | Big | Collider                        |
| ------------ | ----------- | --- | ------------------------------- |
| `pine`       | coniferTree | Yes | Cylinder (bespoke hh 4.5 r 0.9) |
| `deadSpruce` | snagTree    | Yes | Cylinder (hh 3.25, r 0.6)       |
| `erratic`    | ballRock    | Yes | Ball (`ballRock` radius fn)     |
| `iceRock`    | ballRock    | Yes | Ball (`iceRockRadius`)          |
| `snowBush`   | lumpyShrub  | No  | None                            |
| `frostTuft`  | groundDecor | No  | None                            |

# Alpine builders (028)

`alpine/flora.ts` builds 6 granite-palette kinds. Four are archetype-built;
only screeRock + lichenBush keep bespoke geometry. alpinePine is the
`coniferTree` archetype (`trunkHRange:[11,15]`, ~11-15 m trunk + tapering
cone tiers -> ~15-20 m total); fir is a shorter dense `coniferTree`;
alpineSnag is a `snagTree`; alpineBloom is a `groundDecor` petal. screeRock
is a bespoke noisy dodecahedron; lichenBush a small flat squashed
icosahedron. The alpinePine collider is pinned bespoke (`halfHeight` 6 +
`radius` 0.95) to span the taller spire's lower-trunk bulk.
`screeRockRadius(seed)` shares the first RNG draw with the visual so the
ball collider tracks visible bulk (PropField.createBody parity).

| Kind          | Builder     | Big | Collider                              |
| ------------- | ----------- | --- | ------------------------------------- |
| `alpinePine`  | coniferTree | Yes | Cylinder (bespoke hh 6, r 0.95)       |
| `fir`         | coniferTree | Yes | Cylinder (hh 3.88, r 0.75)            |
| `alpineSnag`  | snagTree    | Yes | Cylinder (hh 3.75, r 0.68)            |
| `screeRock`   | bespoke     | Yes | Ball (`screeRockRadius`, `ROCK_BURY`) |
| `lichenBush`  | bespoke     | No  | None                                  |
| `alpineBloom` | groundDecor | No  | None                                  |

# Desert builders (026)

`desert/flora.ts` builds 8 warm-palette kinds. Cactus is a bespoke merged
column + 2-3 splayed arms (per-seed 4.9-7.3 m); sandRock is a bespoke noisy
dodecahedron; yucca is shared crossed spike blades; dryShrub is a shared
squashed icosahedron. Four archetype kinds round it out: mesaRock
(`ballRock`, big flattened boulder), desertSnag (`snagTree`, sun-bleached
deadwood), barrelCactus (`lumpyShrub`, squat green dome), desertBloom
(`groundDecor` petal, hot cactus-flower accent). `sandRockRadius(seed)`
shares the first RNG draw with the visual for ball-collider parity
(PropField.createBody).

| Kind           | Builder     | Big | Collider                             |
| -------------- | ----------- | --- | ------------------------------------ |
| `cactus`       | bespoke     | Yes | Cylinder (hh 2.8, r 0.55)            |
| `mesaRock`     | ballRock    | Yes | Ball (`ballRock` radius fn)          |
| `desertSnag`   | snagTree    | Yes | Cylinder (hh 2.88, r 0.53)           |
| `sandRock`     | bespoke     | Yes | Ball (`sandRockRadius`, `ROCK_BURY`) |
| `yucca`        | bespoke     | No  | None                                 |
| `dryShrub`     | bespoke     | No  | None                                 |
| `barrelCactus` | lumpyShrub  | No  | None                                 |
| `desertBloom`  | groundDecor | No  | None                                 |

# Cross-References

- [Dressing](/environment/dressing.md)
- [PropFactory](/environment/prop-factory.md)
- [Biomes](/biomes/framework.md)
