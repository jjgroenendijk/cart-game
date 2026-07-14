---
type: Subsystem
title: Dressing
description: "Procedural prop placement: flora registry, deterministic sampling, Rapier colliders."
tags: [environment, props, flora, dressing]
timestamp: 2026-07-14T00:00:00Z
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

`baseSeed` defaults to `1337`, but in production `Environment` derives it from
the world seed: when `EnvironmentOptions.seed` is set, `Environment`
fans out `(hashSeed("dressing") ^ seed) >>> 0` into `baseSeed` (and likewise
`clouds`/`weather`/`wildlife` via `worldSubSeeds`). Explicit caller slice seeds
win. So flora placement varies with the circuit seed, not just the track.

`PropField` owns prop Rapier bodies; kind-agnostic via `floraFor(kind)`.
`dispose()` required for cleanup.

Props placed at raw terrain height (geometry base-at-y=0). Rock visual
radius and collider share `rockRadius(seed)`.

## Chunk Streaming

`DressingChunkManager` streams per-chunk `PropField` bundles driven by
camera focus. Activate/deactivate + dispose cascade. `update(cameras, dt)`
takes the frame dt to advance bundle fades.

Big props (tree/rock) merge into spatial buckets; Rapier colliders stay
per-prop. `MAX_BIG_PROPS_PER_CHUNK = 8`.

### Collider-range decoupling

Prop visual range is decoupled from prop collider range so props stream to the
fog horizon without multiplying Rapier bodies. Two passes run each frame:
`update(cameras, dt)` streams and fades bundles around the camera focus
(`streamRadius`/`cullRadius`), while `refreshColliders(foci)` spawns a bundle's
per-prop bodies only while its chunk center is within `colliderRadius` (XZ) of a
collider focus (kart/AI position), and removes them past `colliderCullRadius`
(hysteresis). `PropField` retains its big-prop placements so
`setColliders(true|false)` (re)builds or frees the fixed bodies on demand;
merged prop meshes and instanced decor are untouched by the toggle. `PropField`
also accepts `colliders: false` to build a bundle bodyless from the start.
`colliderRadius`/`colliderCullRadius` default to `Infinity` (every visible
bundle keeps bodies — coupled behavior); `Game` passes finite, world-independent
values and sources the foci from `FieldBuilder.kartFoci()` (all human + AI kart
positions), so props near any kart — including a far off-camera rival — keep
colliders while distant scenery renders body-free.

Dither fade: streamed bundles dissolve instead of popping at the
stream/cull radii. New bundles activate at fade 0 and ramp to 1 over
`fadeSeconds` (default 0.45; 0 = instant pop); culled bundles ramp to 0
first and are deactivated only once fully dissolved, so a camera returning
inside `cullRadius` mid-fade reverses the ramp (the key stays active — the
planner never double-activates). The ctor seed ring snaps to fade 1 so the
initial world build shows fully dressed. `PropField.setFade(v)` drives the
per-material `uFade` on big-bucket `CelMaterial`s + their inverted-hull
outlines (ordered-dither discard, `src/materials/fade.ts`); decor
(bush/flower/grass) keeps plain materials — sub-metre instanced decor is
subpixel at the stream edge. Rapier colliders are gated separately by the
collider-range pass (below), not by the visual fade.

## Wildlife

`critters.ts`: pure wildlife placement + orbit pose, WebGL-free. Wildlife
InstancedMesh owns GL rendering.

## Start-Line Dressing

Two-module split at the start/finish pose (spline `t=0`): a pure
decal builder and a field-scoped GL owner.

### `src/environment/trackDecals.ts`

Pure checkered start-line decal builder. No THREE/WebGL/DOM: emits
typed arrays the GL owner wraps in a `BufferGeometry` + `CelMaterial`.

- `buildStartLine(pose, probe, opts)` -> `{ positions, colors,
indices }`. The checker is a `rows x cols` grid of independent quads
  (cells do NOT share vertices) so each cell carries a uniform
  light/dark vertex color -> crisp checker from `vertexColors` alone
  (zero textures).
- Local frame: `forward` is the unit track tangent (XZ); `right` is
  its XZ perpendicular. The grid spans the full road width
  (`2 x halfWidth`) across `right` and `rows x cellSize` along
  `forward`. Winding is CCW from above so the front face points +Y.
- Every corner is terrain-conformed via the injected `HeightProbe`
  (`heightAt` + `normalAt` lift), the same recipe `SkidMarksLayer.ts`
  uses lie flat through the layer-1 Sobel pass without z-fighting.
- `cols` is derived from `halfWidth / cellSize` (rounded, min 1), so
  the checker tiles variable-width circuits. Deterministic from
  `pose` + `probe`: identical inputs -> byte-identical buffers.

### `src/environment/TrackDressing.ts`

Field-scoped GL owner. The ctor adds its `group` to the scene;
`dispose()` frees all geometries + materials + outlines + the two post
Rapier bodies and detaches the group, so FieldBuilder just holds the
ref and forwards `update`/`dispose`. Builds three `BufferGeometry`s:

- Decal mesh — wraps `buildStartLine` output in `CelMaterial` +
  `vertexColors`, layer 1, `polygonOffset` for a crisp Sobel edge with
  no z-fighting.
- Gantry — two posts + a crossbar spanning the road (merged cel
  geometry, layer 0, inverted-hull outline). The crossbar is level at
  the higher post top, so the lower post grows taller to meet it; each
  post's stored height feeds BOTH the visual cylinder and its fixed
  Rapier cylinder collider, so visual + collision agree on sloped
  start lines. Posts sit `POST_MARGIN` outside the road half-width,
  clear of the race line.
- Flag — one large checkered finish flag at the crossbar centre. A
  custom wave `ShaderMaterial` flutters it (sine of a hang param +
  `uTime`, amplitude ramped 0 at the fixed top edge -> max at the free
  bottom), reading `lightUniforms` so it darkens at night. Checker via
  vertex colors (zero textures).

`update(time)` advances the flag wave (no-op before/after dispose).
Output is LINEAR; `OutputPass` applies ACES + sRGB. All geometry is
procedural (zero committed assets).

# Cross-References

- [Biomes](/biomes/framework.md)
- [Chunk Streaming](/terrain/chunk-streaming.md)
- [KartController](/kart/controller.md)
