# Biome authoring runbook

A biome is pure data on the 025 framework: a `BiomeDefinition` (~40 lines)
plus a flora config of parameterized archetypes (~30 lines). The kit (055)
proves the result is registered, readable, drivable, and above water before
anyone runs the game. A reader following only this doc can add a biome.

## Definition checklist

A `BiomeDefinition` (src/terrain/biomes.ts) is this shape:

- `id: string` -> biome identity; resolves via `resolveBiome(id)`.
- `label: string` -> menu display label.
- `terrain: Partial<TerrainConfig>` -> overrides only; spread over
  `DEFAULT_TERRAIN_CONFIG` by `biomeTerrain(def)` (single resolution point).
  Keys: `noiseAmp/noiseFreq/noiseOctaves/rockSlope/sandLevel/colorRoad/
colorGrass/colorSand/colorRock` + a few noise seeds.
- `flora: ReadonlyArray<{kind, count}>` -> kind name (resolved by the flora
  registry) + per-chunk count. PER-CHUNK, not per-world.
- `weather: Record<string, number>` -> preset weights; `clear/rain/snow/`
  `fog/sandstorm/blizzard/heatHaze/aurora`. `selectWeatherPreset` walks the
  cumulative sum, so only relative weights matter.
- `waterColor?: number` -> water surface tint (sRGB hex); undefined = default.
- `waterLevel?: number` -> water plane height; undefined = sandLevel default.
- `skyFogBias?: {fogTint?, skyTint?}` -> Environment lerps fog + sky toward
  these by 0.2 (biome bias cascade, 025).
- `wildlife?: ReadonlyArray<string>` -> ambient critter kinds; undefined opts
  out (temperate/desert/alpine/tundra all ship without it).

Temperate is the parity baseline: `terrain: {}` + all optionals undefined.
`biomeTerrain(temperate)` is bit-identical to the pre-biome
`DEFAULT_TERRAIN_CONFIG`. Keep it that way (registry suite asserts it).

## Flora via archetypes

Five parameterized builders (src/environment/flora/archetypes.ts). Each takes
a config of knobs, returns the `{build, big, collider}` shape `registerFlora`
consumes, so a biome assembles its flora from data. All geometry is
base-at-y=0, deterministic from seed, and WebGL-free (jsdom-testable).

Big props get a Rapier body + merge into spatial buckets (one mesh/bucket);
decor get an InstancedMesh + no collider.

Vertex budgets (enforced by `archetypes.test.ts`): big <= 600 tris, decor
<= 60 tris. Measured defaults all pass with headroom.

Knob names/defaults copied verbatim from `archetypes.ts`:

- `coniferTree(cfg)` -> stacked-cone conifer (fir/spruce/pine spire). Big,
  cylinder collider.
  - `trunkH` (8) -> trunk height.
  - `trunkRadius` (0.5) -> trunk base radius; top tapers to ~0.8x.
  - `tiers` (4) -> fixed foliage tier count; ignored when `tierCounts` set.
  - `tierCounts` -> per-seed tier count via `rng.pick` (alpine [4,5] /
    tundra [3,4]).
  - `tierRadius` (2.6) -> base radius of bottom tier; upper shrink ~15%/tier.
  - `tierH` (3.2) -> height of each foliage cone tier.
  - `foliage` ([0x2f4a2a]) -> foliage palette; each non-cap tier picks one.
  - `trunkColor` (0x4a3526).
  - `capColor?` -> optional color on TOP tier only (snow-laden crown).
- `canopyTree(cfg)` -> canopy-on-trunk broadleaf. Big, cylinder collider.
  - `trunkH` (4).
  - `trunkRadius` (0.55) -> top tapers to ~0.64x.
  - `lobes` (3) -> fixed lump count; ignored when `lobeCounts` set.
  - `lobeCounts` -> per-seed lump count via `rng.pick` (temperate [2,3,3,4]).
  - `canopyR` (2.4) -> max radius of a lump; per-lump rng-scaled down.
  - `foliage` ([0x4f7a3a, 0x5b8a42]).
  - `trunkColor` (0x6b4f2e).
  - `jitter` (0.5) -> horizontal offset range per lump (in [-jitter, jitter]).
- `ballRock(cfg)` -> noisy dodecahedron rock. Big, ball collider sharing the
  visual radius (same first RNG draw).
  - `rMin` (0.9), `rMax` (1.8) -> radius range.
  - `color` (0x7d8a96).
  - `flatten?` -> optional y-scale for squashed rocks (flagstone read).
- `lumpyShrub(cfg)` -> squashed icosahedron shrub. Decor, no collider.
  - `r` (0.9).
  - `squashY` (0.7) -> y-scale squash (lower = hugging the ground).
  - `color` (0x4f7a3a).
  - `yOffset` (0.45) -> vertical offset (lifts base off ground).
- `groundDecor(cfg)` -> flat ground decor (crossed blades or stem+petal).
  Decor, no collider.
  - `mode` ("blade") -> "blade" = crossed planes (grass); "petal" = stem +
    petal blobs (flower).
  - `h` (0.5) -> blade or stem height.
  - `count` -> blade or petal count (defaults: blade 3, petal 1).
  - `palette` ([0x5b8a42]) -> blades/petals cycle through it by index.
  - `stemColor` (0x4f7a3a) -> stem color (petal mode only).

Register a kind in one line (the archetype returns a complete `FloraBuilder`):

```ts
import { registerFlora } from "../floraRegistry";
import { canopyTree } from "./archetypes";

registerFlora(
  "mytree",
  canopyTree({
    trunkH: 4.5,
    canopyR: 2.6,
    foliage: [0x3f8a3a, 0x4f9a4a],
    trunkColor: 0x6b4f2e,
  }),
);
```

Override a collider when a contract needs pinning (tundra pins the pine
cylinder to halfHeight 2.5 / radius 0.8 rather than the archetype heuristic):
spread the archetype and replace just `collider`.

## When to drop to bespoke

The registry contract (`FloraBuilder = {build, big, collider}`) is unchanged,
so bespoke builders remain first-class. Rule of thumb: try an archetype
first. If a shape the knobs cannot express is load-bearing for the biome's
read, write a bespoke builder returning the same `{build, big, collider}`
shape and `registerFlora` it.

Examples of load-bearing bespoke shapes: saguaro arms (desert `cactus` in
src/environment/flora/desert.ts), a mangrove root skirt (029), a mushroom
cap. The desert cactus is the reference bespoke example: it hand-builds a
column + 1-2 connector+branch arms per seed, then registers a cylinder
collider pinned to the trunk.

Author the bespoke builder base-at-y=0, deterministic from seed, WebGL-free
for jsdom tests. Keep it <= 600 lines.

## Validator

`validateBiome(def, ctx)` (src/terrain/biomeValidate.ts) returns findings;
empty = clean. Errors block (fix before merge); warns advise (tune if you
can, merge is allowed). Static checks always run; dynamic checks
(`DRIVE_GRADE`, `WATER_FLORA_SUNK`) run only when `ctx.heightAt` +
`ctx.corridor` are provided.

Build the real ctx (mirror src/terrain/biomes.registry.test.ts):

- `registeredKinds` = `new Set(registeredFloraKinds())` from floraRegistry.
- `isBigKind` = `(kind) => floraFor(kind).big` (try/catch -> false).
- `knownWeatherKeys` = `new Set(["clear", ...Object.keys(WEATHER_PRESET_CONFIG)])`.
- `bigPerChunkCap` = `MAX_BIG_PROPS_PER_CHUNK` (8).
- `heightAt` = real `heightAt(x,z,cache,cfg,noise)` via `SplineFieldCache` +
  `SimplexNoise2D(cfg.noiseSeed)` over `biomeTerrain(def)`.
- `corridor` = 64 arc-length-even centerline points off the default
  `SplineTrack`.

Every code -> level -> meaning / fix:

| Code                  | Level | What it means / how to fix                    |
| --------------------- | ----- | --------------------------------------------- |
| `FLORA_NEG`           | error | a flora `count < 0` -> set non-negative.      |
| `FLORA_UNKNOWN`       | error | a `kind` not registered (typo) -> fix it.     |
| `FLORA_COUNT`         | error | big-prop sum > 8/chunk -> lower big counts.   |
| `WEATHER_NEG`         | error | a weather `weight < 0` -> set >= 0.           |
| `WEATHER_UNKNOWN`     | error | unknown weather key -> `selectWeatherPreset`  |
|                       |       | drops it silently; fix the key or add preset. |
| `WEATHER_SUM`         | error | weight sum <= 0 -> biome always-clears;       |
|                       |       | add a positive weight.                        |
| `PALETTE_READABILITY` | warn  | road-grass/grass-rock contrast < 0.10;        |
|                       |       | spread the palette. Soft heuristic.           |
| `DRIVE_GRADE`         | error | corridor step > 1.0 or grade > 0.25 ->        |
|                       |       | undrivable wall; guards the shared spline.    |
| `WATER_FLORA_SUNK`    | warn  | terrain floor < `waterLevel` -> flora sunk;   |
|                       |       | raise floor or lower water (043).             |

Thresholds (each named next to its constant in `biomeValidate.ts`):
`STEP_DELTA_CAP = 1.0` (4x kart suspension travel 0.25),
`GRADE_CAP = 0.25` (tan ~14 deg), `PALETTE_CONTRAST_FLOOR = 0.10`.

Corridor is biome-independent: `heightAt` on the track centerline ==
`spline.y` (terrain noise weight 0 on-track), so the corridor profile is the
same for every biome. `DRIVE_GRADE` therefore guards the shared SPLINE, not
biome relief; biome-specific relief (noise) lives off-corridor and is what
`WATER_FLORA_SUNK`'s floor sampling touches.

## 052 scene auto-inclusion

Plan 052's visual-verify matrix reads the biome registry (`BIOMES`), so a
newly registered biome appears in the screenshot matrix + the menu with zero
extra wiring (once 052 lands). The menu auto-renders one button per `BIOMES`
entry; no UI change is needed for a new biome.

## Reference implementation

Copy tundra. src/environment/flora/tundra.ts is the smallest biome built on
archetypes (3 kinds: pine/iceRock/snowBush). Start from it: it shows
`coniferTree` + `ballRock` + `lumpyShrub` configs, a pinned collider override,
and the `iceRockRadius` radius-fn delegation to `ballRock`'s collider. Then
add your `BiomeDefinition` to `BIOMES` in src/terrain/biomes.ts and run the
validator + the registry suite.

## See also

- 055 biome-authoring-kit (the kit this runbook documents).
- 043 flora-avoids-water (sampler fix for the `WATER_FLORA_SUNK` data case).
- 052 visual-verify-harness (scene matrix auto-covers new biomes).
