---
type: Subsystem
title: Biome Validator
description: "validateBiome(def, ctx) — finding codes, thresholds, and corridor invariance."
tags: [biomes, validation]
timestamp: 2026-07-11T00:00:00Z
---

# Schema

`src/environment/biomes/validate.ts` validates a `BiomeDefinition` against injected
context. Pure (no module side effects, no registration). Returns
`ValidationFinding[]`; empty = clean.

## Interface

```ts
function validateBiome(def: BiomeDefinition, ctx: ValidateCtx): ValidationFinding[];

interface ValidationFinding {
  level: "error" | "warn";
  code: string;
  msg: string;
}
```

`ValidateCtx` is injected (rather than imported) so `biomes/` validation
stays free of an `environment/` dependency:

| Field              | Source                                    |
| ------------------ | ----------------------------------------- |
| `registeredKinds`  | `floraRegistry.registeredFloraKinds()`    |
| `isBigKind`        | `floraRegistry.floraFor(kind).big`        |
| `knownWeatherKeys` | `WEATHER_PRESET_CONFIG` keys + "clear"    |
| `bigPerChunkCap`   | Defaults to `MAX_BIG_PROPS_PER_CHUNK (8)` |
| `heightAt`         | Optional; absent → dynamic checks skip    |
| `corridor`         | Optional; absent → DRIVE_GRADE skips      |

## Finding Codes

Errors block; warns are advisory.

| Code                  | Level | Means / fix                                   |
| --------------------- | ----- | --------------------------------------------- |
| `FLORA_NEG`           | error | count < 0 → set non-negative                  |
| `FLORA_UNKNOWN`       | error | kind not registered → fix typo                |
| `FLORA_COUNT`         | error | big sum > cap → lower big-prop counts         |
| `WEATHER_NEG`         | error | weight < 0 → set >= 0                         |
| `WEATHER_UNKNOWN`     | error | key not a preset → fix or add preset          |
| `WEATHER_SUM`         | error | sum <= 0 → biome always-clears                |
| `PALETTE_READABILITY` | warn  | band contrast < 0.10 → spread road/grass/rock |
| `DRIVE_GRADE`         | error | step > 1.0 or grade > 0.25 wall               |
| `WATER_FLORA_SUNK`    | warn  | floor < waterLevel → flora bases underwater   |

## Thresholds

| Constant                 | Value | Source / meaning                             |
| ------------------------ | ----- | -------------------------------------------- |
| `STEP_DELTA_CAP`         | 1.0   | 4x kart suspension travel (0.25)             |
| `GRADE_CAP`              | 0.25  | tan ~14 deg arcade drivability cap           |
| `PALETTE_CONTRAST_FLOOR` | 0.10  | LINEAR-space Euclidean; below shipped biomes |

## Corridor Invariance

`heightAt` on the track centerline == `spline.y` — terrain noise weight is
0 on-track by construction. Therefore the corridor height profile is
**biome-independent**: `DRIVE_GRADE` validates the shared SPLINE drivability,
not biome-specific relief. Biome relief (noise) lives off-corridor and is
what `WATER_FLORA_SUNK`'s floor sampling touches by sampling the full
`heightAt` (noise included) at corridor points.

## Static vs Dynamic

- Static checks always run: `FLORA_NEG`, `FLORA_UNKNOWN`, `FLORA_COUNT`,
  `WEATHER_NEG`, `WEATHER_UNKNOWN`, `WEATHER_SUM`, `PALETTE_READABILITY`.
- Dynamic checks run only when `ctx.heightAt` + `ctx.corridor` are both provided:
  `DRIVE_GRADE`, `WATER_FLORA_SUNK`.

## See Also

- [Biome Framework](framework.md) — `BiomeDefinition` schema and registry
