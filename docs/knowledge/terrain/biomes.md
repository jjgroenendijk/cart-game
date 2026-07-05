---
type: Subsystem
title: Biomes
description: "BiomeDefinition registry: terrain overrides, flora, weather weights, validation."
tags: [terrain, biomes, data]
timestamp: 2026-07-05T00:00:00Z
---

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
  waterColor?: Color;
  waterLevel?: number;
  skyFogBias?: Readonly<{ fogTint?: number; skyTint?: number }>;
  wildlife?: ReadonlyArray<string>;
}
```

`MAX_BIG_PROPS_PER_CHUNK = 8`.

## Registered Biomes

| ID        | Terrain | Flora                                                |
| --------- | ------- | ---------------------------------------------------- |
| temperate | default | tree(2) rock(1) bush(3) flower(23) grass(47)         |
| desert    | sandy   | cactus(2) sandRock(2) yucca(5) dryShrub(30)          |
| alpine    | rocky   | alpinePine(3) screeRock(2) lichenBush(25)            |
| tundra    | flat    | pine(3) iceRock(2) snowBush(20)                      |
| tropical  | lush    | palm(2) jungleRock(2) fernShrub(5) tropicalFlower(8) |

Weather weights per biome (`BiomeWeather = Record<string, number>`):

- temperate: `{ clear: 0.7, rain: 0.15, snow: 0.15 }`
- desert: `{ clear: 0.85, sandstorm: 0.1, heatHaze: 0.05 }`
- alpine: `{ clear: 0.55, snow: 0.35, blizzard: 0.1 }`
- tundra: `{ clear: 0.5, snow: 0.35, blizzard: 0.15 }`
- tropical: `{ clear: 0.4, rain: 0.3, warmRain: 0.3 }`

Temperate is the parity baseline: `terrain: {}` + all optionals `undefined`.
`biomeTerrain(temperate)` is bit-identical to `DEFAULT_TERRAIN_CONFIG`.

## selectBiome

`selectBiome(seed)` (in `biomes.ts`) performs a deterministic equal-weight roll
across the `BIOMES` array. It is available for seeded selection and covered by
tests; current startup/menu flow uses explicit biome selection rather than this
helper.

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
- `src/terrain/biomeValidate.ts`
