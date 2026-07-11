---
type: Subsystem
title: Biome Framework
description: "BiomeDefinition registry: terrain overrides, flora, weather weights, validation."
tags: [biomes, terrain, data]
timestamp: 2026-07-11T00:00:00Z
---

# Layout

Each biome owns one directory, `src/environment/biomes/<id>/`: `biome.ts` (the
`BiomeDefinition`) + `flora.ts` (prop builders, registered at module load) +
an `AGENTS.md` linking the biome's art + vibe guide (`/biomes/<id>.md`
here). Shared pieces live beside them: `src/environment/biomes/definition.ts` (types),
`src/environment/biomes/registry.ts` (the `BIOMES` record + resolve/index helpers), and
`src/environment/biomes/validate.ts` (validation).

# Schema

## BiomeDefinition

Pure data struct. `resolveBiome(id)` never throws — unknown IDs fall back to
temperate. `biomeTerrain(def)` resolves partial terrain config overrides over
`DEFAULT_TERRAIN_CONFIG`.

```ts
interface BiomeDefinition {
  id: string;
  label: string;
  terrain: Partial<TerrainConfig>;
  flora: ReadonlyArray<{ kind: string; count: number }>;
  weather: BiomeWeather;
  waterColor?: number;
  waterLevel?: number;
  waterShallow?: number;
  waterDeep?: number;
  skyFogBias?: Readonly<{
    fogTint?: number;
    skyTint?: number;
    skyZenithTint?: number;
    skyHorizonTint?: number;
    sunTint?: number;
    ambientTint?: number;
    factor?: number;
  }>;
  wildlife?: ReadonlyArray<string>;
  track?: Readonly<Partial<TrackTraits>>;
}
```

`MAX_BIG_PROPS_PER_CHUNK = 8`.

`skyFogBias` is all-optional: undefined = identity. `factor` defaults to
`BIOME_TINT_FACTOR` (0.2) when unset; tropical sets 0.28. Only tropical
defines `sunTint`/`ambientTint`/`skyZenithTint`/`skyHorizonTint`; desert/
alpine/tundra keep the shared `fogTint` + `skyTint` pair only.

`waterColor`, `waterShallow`, and `waterDeep` are sRGB hex numbers. `track`
overrides the default width range, width variation, branch chance, and branch
bias for a biome; see [Track Traits](/terrain/track-traits.md).

## Registered Biomes

| ID        | Terrain | Flora                                        |
| --------- | ------- | -------------------------------------------- |
| temperate | default | tree(2) rock(1) bush(3) flower(23) grass(47) |
| desert    | sandy   | cactus(2) sandRock(2) yucca(5) dryShrub(30)  |
| alpine    | rocky   | alpinePine(3) screeRock(2) lichenBush(25)    |
| tundra    | flat    | pine(3) iceRock(2) snowBush(20)              |
| tropical  | lush    | palm(4) jungleRock(2) + 4 shore decor kinds  |

Tropical decor: fernShrub(3), tropicalFlower(8), seaOats(12),
hibiscus(4). Big-sum palm+jungleRock = 6 <= MAX_BIG_PROPS_PER_CHUNK 8.

Weather weights per biome (`BiomeWeather = Record<string, number>`):

- temperate: `{ clear: 0.7, rain: 0.15, snow: 0.15 }`
- desert: `{ clear: 0.85, sandstorm: 0.1, heatHaze: 0.05 }`
- alpine: `{ clear: 0.55, snow: 0.35, blizzard: 0.1 }`
- tundra: `{ clear: 0.5, snow: 0.35, blizzard: 0.15 }`
- tropical: `{ clear: 0.7, warmRain: 0.2, rain: 0.1 }`

Temperate is the parity baseline: `terrain: {}` + all optionals `undefined`.
`biomeTerrain(temperate)` is bit-identical to `DEFAULT_TERRAIN_CONFIG`.

## selectBiome

`selectBiome(seed)` (in `src/environment/biomes/registry.ts`) performs a deterministic
equal-weight roll
across `Object.values(BIOMES)`. It survives ONLY as the randomize-time biome
derivation: its RNG partition is unchanged, but it is no longer used to
re-derive a biome from a stored circuit code (that now goes through the stable
index registry below). At randomize time the chosen `BiomeDefinition` is
converted to a stable index via `biomeIndexOf(def.id)`.

## Biome Index Registry

`BIOME_ORDER` (`src/environment/biomes/registry.ts`) is a stable, APPEND-ONLY
`readonly BiomeId[]`. The position of a biome id in this list is the stable
field encoded in circuit codes (`src/terrain/circuitCode.ts`): a
stored biome index always maps back to the same biome. Reordering entries
silently remaps every shared circuit code in the wild; new biomes MUST be
APPENDED to both `BIOME_ORDER` and `BIOMES` (the two are pinned in sync by
`src/environment/biomes/order.test.ts`).

- `biomeByIndex(index)` -> `BiomeDefinition`: resolve a stored index back to
  its biome. Out-of-range / NaN / non-integer degrade to temperate (never
  throws), mirroring `resolveBiome`.
- `biomeIndexOf(id)` -> `number`: the stable index of a biome id. Unknown ids
  degrade to `0` (temperate).

`biomeByIndex(biomeIndexOf(id)).id === id` for every registered biome.

## Validation

`validateBiome(def, ctx)` checks:

| Error Code            | Condition                                     |
| --------------------- | --------------------------------------------- |
| `FLORA_NEG`           | Negative flora count                          |
| `FLORA_UNKNOWN`       | Flora kind not in registry                    |
| `FLORA_COUNT`         | Count exceeds per-chunk limit                 |
| `WEATHER_NEG`         | Negative weather weight                       |
| `WEATHER_UNKNOWN`     | Weather preset not found                      |
| `WEATHER_SUM`         | Weather weight sum <= 0 (biome always-clears) |
| `PALETTE_READABILITY` | Insufficient palette contrast                 |
| `DRIVE_GRADE`         | Terrain slope too steep for driving           |
| `WATER_FLORA_SUNK`    | Flora below water level                       |

Flora references kind names in the [flora registry](/environment/dressing.md).
Weather weights resolve via `selectWeatherPreset`.

# Citations

- [Weather](/environment/weather.md)
- [Dressing](/environment/dressing.md)
- `src/environment/biomes/validate.ts`
