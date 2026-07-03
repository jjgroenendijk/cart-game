import { hashSeed, makeRNG } from "../core/rng";

/**
 * Active weather preset for a session. Clear builds nothing; the rest spawn a
 * Points field. Declaration order is significant: {@link PRESET_ORDER} fixes
 * the cumulative walk so {@link DEFAULT_WEATHER_WEIGHTS} reproduces the
 * pre-biome clear/rain/snow partition bit-for-bit.
 */
export type WeatherPreset =
  | "clear"
  | "rain"
  | "snow"
  | "fog"
  | "sandstorm"
  | "blizzard"
  | "heatHaze"
  | "aurora"
  | "storm";

/**
 * Particle/fog params for a non-clear preset. All fields are cheap scalars
 * consumed by Weather.buildField (Points only — no shaders, no extra passes).
 * Clear has no config because it builds nothing.
 */
export interface WeatherPresetConfig {
  /** Points color (sRGB hex). */
  color: number;
  /** Point size. */
  size: number;
  /** Base opacity. */
  opacity: number;
  /** Vertical fall speed (m/s); negative = downward. */
  fall: number;
  /** Wind multiplier on the base windSpeed (X drift). */
  windFactor: number;
  /** Extra per-particle Z drift magnitude. */
  drift: number;
  /** Fog tint (sRGB hex) the preset lerps dayCycleState.fogColor toward. */
  fogTint: number;
  /** Fog near pull factor in [0,1] (fraction shrunk at full intensity). */
  fogNearFactor: number;
  /** Fog far pull factor in [0,1] (fraction shrunk at full intensity). */
  fogFarFactor: number;
  /** Spawn + wrap ceiling override; undefined = Weather default. */
  ceiling?: number;
}

/**
 * Per-preset particle/fog config. rain + snow mirror the pre-biome constants
 * exactly (color/size/opacity/fall/windFactor/drift/fog factors) so legacy
 * fields stay bit-identical — Weather.buildField keeps the rain/snow velocity
 * init explicit to preserve the per-particle RNG draw order. The five new
 * presets (fog/sandstorm/blizzard/heatHaze/aurora) are cel-faithful, cheap
 * Points fields with no shader cost.
 */
export const WEATHER_PRESET_CONFIG: Readonly<
  Record<Exclude<WeatherPreset, "clear">, WeatherPresetConfig>
> = {
  rain: {
    color: 0x8090a0,
    size: 1.5,
    opacity: 0.6,
    fall: -25,
    windFactor: 1,
    drift: 1,
    fogTint: 0x506070,
    fogNearFactor: 0.2,
    fogFarFactor: 0.15,
  },
  snow: {
    color: 0xffffff,
    size: 2.5,
    opacity: 0.85,
    fall: -2,
    windFactor: 0.4,
    drift: 2,
    fogTint: 0xa8b0b8,
    fogNearFactor: 0.2,
    fogFarFactor: 0.15,
  },
  fog: {
    color: 0x8a8a8a,
    size: 3,
    opacity: 0.35,
    fall: -0.6,
    windFactor: 0.5,
    drift: 0.6,
    fogTint: 0x8a8a8a,
    fogNearFactor: 0.5,
    fogFarFactor: 0.4,
  },
  sandstorm: {
    color: 0xc2a35a,
    size: 2,
    opacity: 0.55,
    fall: -1,
    windFactor: 2,
    drift: 1.5,
    fogTint: 0x9a7a3a,
    fogNearFactor: 0.45,
    fogFarFactor: 0.35,
  },
  blizzard: {
    color: 0xffffff,
    size: 2.5,
    opacity: 0.9,
    fall: -6,
    windFactor: 1.5,
    drift: 3,
    fogTint: 0xb8c0c8,
    fogNearFactor: 0.35,
    fogFarFactor: 0.25,
  },
  heatHaze: {
    color: 0xc8b890,
    size: 0.9,
    opacity: 0.12,
    fall: 0.5,
    windFactor: 0.3,
    drift: 0.4,
    fogTint: 0xb0a890,
    fogNearFactor: 0.05,
    fogFarFactor: 0.05,
  },
  aurora: {
    color: 0x3affb0,
    size: 2,
    opacity: 0.35,
    fall: 0.1,
    windFactor: 0.2,
    drift: 0.8,
    fogTint: 0x2a8a6a,
    fogNearFactor: 0.05,
    fogFarFactor: 0.05,
    ceiling: 55,
  },
  storm: {
    color: 0x707880,
    size: 1.6,
    opacity: 0.7,
    fall: -30,
    windFactor: 1.5,
    drift: 1.5,
    fogTint: 0x303848,
    fogNearFactor: 0.35,
    fogFarFactor: 0.25,
  },
};

/**
 * Default preset weights (clear/rain/snow). selectWeatherPreset with these
 * reproduces the pre-biome `<0.7/<0.85/else` partition bit-for-bit because the
 * cumulative walk order is fixed by {@link PRESET_ORDER}.
 */
export const DEFAULT_WEATHER_WEIGHTS: Readonly<Record<string, number>> = {
  clear: 0.7,
  rain: 0.15,
  snow: 0.15,
};

/**
 * WeatherPreset keys in declaration order. selectWeatherPreset walks the
 * cumulative weights in this order so a weights object whose insertion order
 * differs still partitions deterministically — and so
 * DEFAULT_WEATHER_WEIGHTS reproduces the pre-biome clear/rain/snow partition
 * exactly (clear 0.7, rain 0.15, snow 0.15). DO NOT reorder without updating
 * the parity tests in Weather.test.ts. storm is APPENDED after aurora (has no
 * DEFAULT_WEATHER_WEIGHTS key) so the existing cumulative walk is unchanged.
 */
const PRESET_ORDER: readonly WeatherPreset[] = [
  "clear",
  "rain",
  "snow",
  "fog",
  "sandstorm",
  "blizzard",
  "heatHaze",
  "aurora",
  "storm",
];

/**
 * Deterministic weighted weather preset pick. Pure: same (weights, seed) ->
 * same preset. Weights are filtered to known WeatherPreset keys; if the sum is
 * <= 0 the result is "clear" (safe default). A single roll partitions the
 * cumulative weights walked in {@link PRESET_ORDER}, so with
 * DEFAULT_WEATHER_WEIGHTS the result is bit-identical to the pre-biome pick
 * (`< 0.7 -> clear`, `< 0.85 -> rain`, else snow). Exported separately from
 * Weather so unit tests can exercise distribution + reachability without
 * constructing a particle field.
 */
export function selectWeatherPreset(
  weights: Readonly<Record<string, number>>,
  seed: number,
): WeatherPreset {
  let sum = 0;
  let lastActive: WeatherPreset = "clear";
  for (const key of PRESET_ORDER) {
    const w = weights[key];
    if (w !== undefined && w > 0) {
      sum += w;
      lastActive = key;
    }
  }
  if (sum <= 0) return "clear";
  const rng = makeRNG(hashSeed("weather") ^ seed);
  let roll = rng.next() * sum;
  for (const key of PRESET_ORDER) {
    const w = weights[key];
    if (w === undefined || w <= 0) continue;
    roll -= w;
    if (roll < 0) return key;
  }
  return lastActive; // float-tail guard (roll should always land in a bucket)
}
