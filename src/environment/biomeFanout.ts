import { hashSeed } from "../core/rng";
import type { BiomeDefinition } from "./biomes/registry";
import type { DressingOptions } from "./dressingConfig";
import type { WeatherOptions } from "./Weather";

/**
 * Pure biome -> Environment option fan-out (jsdom-testable, no Rapier/three).
 * Maps biome.flora -> dressing.counts, biome.weather -> weather.weights,
 * biome.waterColor -> water.color, and biome.wildlife -> wildlife.kinds.
 * Returns ONLY the derived slices. Per-frame sky/fog bias is NOT here (it is
 * applied after DynamicSky writes dayCycleState each frame, like
 * Weather.patchFog). For temperate every derived slice is empty (undefined)
 * so the output matches the pre-biome defaults bit-for-bit.
 */
export function biomeEnvironmentOptions(biome: BiomeDefinition): {
  dressing: Pick<DressingOptions, "counts">;
  weather: Pick<WeatherOptions, "weights">;
  water: { color?: number; shallow?: number; deep?: number };
  wildlife: { kinds?: readonly string[] };
} {
  const counts: Record<string, number> = {};
  for (const f of biome.flora) counts[f.kind] = f.count;
  return {
    dressing: { counts },
    weather: { weights: biome.weather },
    water: {
      ...(biome.waterColor !== undefined ? { color: biome.waterColor } : {}),
      ...(biome.waterShallow !== undefined ? { shallow: biome.waterShallow } : {}),
      ...(biome.waterDeep !== undefined ? { deep: biome.waterDeep } : {}),
    },
    wildlife: biome.wildlife !== undefined ? { kinds: biome.wildlife } : {},
  };
}

/**
 * Pure world-seed -> per-subsystem seed fan-out (078). Each label mixes via
 * `hashSeed(label) ^ seed` so dressing/clouds/wildlife/weather vary
 * independently yet deterministically from one root seed (mirrors
 * `selectBiome`'s `hashSeed("biome") ^ seed`). Exported for jsdom unit tests
 * (no DOM, no three.js). Terrain relief has its own label ("terrain") applied
 * in `Game.buildWorld`.
 */
export function worldSubSeeds(seed: number): {
  dressing: number;
  clouds: number;
  weather: number;
  wildlife: number;
} {
  const s = seed >>> 0;
  return {
    dressing: (hashSeed("dressing") ^ s) >>> 0,
    clouds: (hashSeed("clouds") ^ s) >>> 0,
    weather: (hashSeed("weather") ^ s) >>> 0,
    wildlife: (hashSeed("wildlife") ^ s) >>> 0,
  };
}
