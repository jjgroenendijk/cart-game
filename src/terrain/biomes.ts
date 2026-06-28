import { hashSeed, makeRNG } from "../core/rng";
import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "./heightmap";

/** Biome identity; a string so future biomes register without union churn. */
export type BiomeId = string;

/** Flora placement request per biome (kind name resolved later by a flora registry). */
export interface FloraEntry {
  /** Flora kind name (resolved later via a flora registry, e.g. "tree"). */
  kind: string;
  /** How many to place. */
  count: number;
}

/** Weather preset weights; partial record (selectWeatherPreset normalises later). */
export type BiomeWeather = Readonly<Record<string, number>>;

export interface BiomeDefinition {
  id: BiomeId;
  /** Display label for the menu (later commit). */
  label: string;
  /** Terrain cfg OVERRIDES only; resolved against DEFAULT_TERRAIN_CONFIG. */
  terrain: Partial<TerrainConfig>;
  /** Flora placement set (kind name + count). */
  flora: ReadonlyArray<FloraEntry>;
  /** Weather preset weights (clear/rain/snow now; more in a later commit). */
  weather: BiomeWeather;
  /** Optional water surface color override (sRGB hex); undefined = default. */
  waterColor?: number;
  /** Optional water level override; undefined = DEFAULT_TERRAIN_CONFIG.sandLevel. */
  waterLevel?: number;
  /** Optional sky/fog tint bias for the biome (later commit). */
  skyFogBias?: Readonly<{ fogTint?: number; skyTint?: number }>;
  /** Optional ambient wildlife kind names (later commit). */
  wildlife?: ReadonlyArray<string>;
}

const TEMPERATE_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "tree", count: 120 },
  { kind: "rock", count: 80 },
  { kind: "bush", count: 200 },
  { kind: "flower", count: 1500 },
  { kind: "grass", count: 3000 },
];

const TEMPERATE_WEATHER: BiomeWeather = {
  clear: 0.7,
  rain: 0.15,
  snow: 0.15,
};

export const BIOMES: Readonly<Record<BiomeId, BiomeDefinition>> = {
  temperate: {
    id: "temperate",
    label: "Temperate",
    terrain: {},
    flora: TEMPERATE_FLORA,
    weather: TEMPERATE_WEATHER,
  },
};

const DEFAULT_BIOME_ID: BiomeId = "temperate";

/**
 * Deterministic weighted biome pick. Each registered biome carries implicit
 * equal weight; a single roll partitions [0, n) so the same seed always picks
 * the same biome. With only temperate registered this always returns it.
 */
export function selectBiome(seed: number): BiomeDefinition {
  const entries = Object.values(BIOMES);
  const roll = makeRNG(hashSeed("biome") ^ seed).next() * entries.length;
  let acc = 0;
  for (const def of entries) {
    acc += 1;
    if (roll < acc) return def;
  }
  return entries[entries.length - 1]!;
}

/**
 * Resolve a biome id to its definition. Undefined or unknown ids fall back to
 * the temperate biome (never throws) so a bad id degrades to default parity.
 */
export function resolveBiome(id?: BiomeId): BiomeDefinition {
  if (id !== undefined) {
    const def = BIOMES[id];
    if (def !== undefined) return def;
  }
  return BIOMES[DEFAULT_BIOME_ID]!;
}

/**
 * Merge a biome's terrain overrides over DEFAULT_TERRAIN_CONFIG. Accepts a
 * BiomeDefinition or an id (resolved first). Single source of truth for what
 * terrain cfg a biome produces; temperate (empty overrides) yields bit-identical
 * parity with the pre-biome DEFAULT_TERRAIN_CONFIG.
 */
export function biomeTerrain(biome: BiomeDefinition | BiomeId): TerrainConfig {
  const def = typeof biome === "string" ? resolveBiome(biome) : biome;
  return { ...DEFAULT_TERRAIN_CONFIG, ...def.terrain };
}
