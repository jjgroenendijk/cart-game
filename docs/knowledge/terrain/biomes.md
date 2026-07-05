---
type: Subsystem
title: Biomes
description: BiomeDefinition registry: terrain overrides, flora lists, weather weights, validation.
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
  terrain?: Partial<TerrainConfig>;
  flora?: { kind: string; count: number }[];
  weather?: { preset: string; weight: number }[];
  waterColor?: Color;
  waterLevel?: number;
  skyFogBias?: number;
  wildlife?: string[];
}
```

`MAX_BIG_PROPS_PER_CHUNK = 8`.

## Registered Biomes

| ID        | Terrain | Flora | Weather      |
| --------- | ------- | ----- | ------------ |
| temperate | default | none  | mixed        |
| desert    | sandy   | cacti | dry/windy    |
| alpine    | rocky   | pines | snow/mild    |
| tundra    | flat    | moss  | cold/snow    |
| tropical  | lush    | palms | rain/monsoon |

Temperate is the parity baseline: `terrain: {}` + all optionals `undefined`.
`biomeTerrain(temperate)` is bit-identical to `DEFAULT_TERRAIN_CONFIG`.

## Validation

`validateBiome(def, ctx)` checks:

| Error Code            | Condition                           |
| --------------------- | ----------------------------------- |
| `FLORA_NEG`           | Negative flora count                |
| `FLORA_UNKNOWN`       | Flora kind not in registry          |
| `FLORA_COUNT`         | Count exceeds per-chunk limit       |
| `WEATHER_NEG`         | Negative weather weight             |
| `WEATHER_UNKNOWN`     | Weather preset not found            |
| `WEATHER_SUM`         | Weather weights don't sum to 1      |
| `PALETTE_READABILITY` | Insufficient palette contrast       |
| `DRIVE_GRADE`         | Terrain slope too steep for driving |
| `WATER_FLORA_SUNK`    | Flora below water level             |

Flora references kind names in the [flora registry](/environment/dressing.md).
Weather weights resolve via `selectWeatherPreset`.

# Citations

- [Weather](/environment/weather.md)
- [Dressing](/environment/dressing.md)
- [biomeValidate.ts](biomeValidate.ts)
