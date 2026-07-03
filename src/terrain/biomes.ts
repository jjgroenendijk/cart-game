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
  { kind: "tree", count: 2 },
  { kind: "rock", count: 1 },
  { kind: "bush", count: 3 },
  { kind: "flower", count: 23 },
  { kind: "grass", count: 47 },
];

const TEMPERATE_WEATHER: BiomeWeather = {
  clear: 0.7,
  rain: 0.15,
  snow: 0.15,
};

/** Desert biome flora: sparse per-chunk scrub (mostly dry shrub). */
const DESERT_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "cactus", count: 2 },
  { kind: "sandRock", count: 2 },
  { kind: "yucca", count: 5 },
  { kind: "dryShrub", count: 30 },
];

/** Desert weather weights: mostly clear, rare sandstorm, trace heatHaze. */
const DESERT_WEATHER: BiomeWeather = {
  clear: 0.85,
  sandstorm: 0.1,
  heatHaze: 0.05,
};

/** Alpine biome flora: per-chunk mountain forest (pines + scree + lichen). */
const ALPINE_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "alpinePine", count: 3 },
  { kind: "screeRock", count: 2 },
  { kind: "lichenBush", count: 25 },
];

/** Alpine weather weights: clear, snow-heavy, occasional blizzard. */
const ALPINE_WEATHER: BiomeWeather = {
  clear: 0.55,
  snow: 0.35,
  blizzard: 0.1,
};

/** Tundra biome flora: sparse per-chunk frozen forest (pines + ice rocks). */
const TUNDRA_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "pine", count: 3 },
  { kind: "iceRock", count: 2 },
  { kind: "snowBush", count: 20 },
];

/** Tundra weather weights: clear, snow-heavy, occasional blizzard. */
const TUNDRA_WEATHER: BiomeWeather = {
  clear: 0.5,
  snow: 0.35,
  blizzard: 0.15,
};

/** Tropical biome flora: dense per-chunk jungle (palms + jungle rock). */
const TROPICAL_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "palm", count: 2 },
  { kind: "jungleRock", count: 2 },
  { kind: "fernShrub", count: 5 },
  { kind: "tropicalFlower", count: 8 },
];

/** Tropical weather weights: clear, rain, warm rain. */
const TROPICAL_WEATHER: BiomeWeather = {
  clear: 0.4,
  rain: 0.3,
  warmRain: 0.3,
};

export const BIOMES: Readonly<Record<BiomeId, BiomeDefinition>> = {
  temperate: {
    id: "temperate",
    label: "Temperate",
    terrain: {},
    flora: TEMPERATE_FLORA,
    weather: TEMPERATE_WEATHER,
  },
  desert: {
    id: "desert",
    label: "Desert",
    terrain: {
      noiseAmp: 4,
      noiseFreq: 0.008,
      sandLevel: 3,
      rockSlope: 1.1,
      colorRoad: 0xb39b6e,
      colorGrass: 0xc2a14d,
      colorSand: 0xe3cf8e,
      colorRock: 0xb08d5a,
    },
    flora: DESERT_FLORA,
    weather: DESERT_WEATHER,
    waterLevel: -100,
    skyFogBias: { fogTint: 0xe8cf9a, skyTint: 0x8fb6c8 },
  },
  alpine: {
    id: "alpine",
    label: "Alpine",
    terrain: {
      // Towering massifs: high amplitude + low freq make wide mountains
      // (not bumpy hills), extra octaves add rugged ridge detail, and a low
      // rockSlope exposes granite on more moderate grades -> cliffs read.
      noiseAmp: 32,
      noiseFreq: 0.0055,
      noiseOctaves: 5,
      rockSlope: 0.55,
      colorRoad: 0x6e6256,
      colorGrass: 0x4f7a3a,
      colorSand: 0xc2b280,
      colorRock: 0x8a8a92,
    },
    flora: ALPINE_FLORA,
    weather: ALPINE_WEATHER,
    waterColor: 0xaec4cc,
    waterLevel: -5,
    skyFogBias: { fogTint: 0xb8c4cc, skyTint: 0x4a6a8a },
  },
  tundra: {
    id: "tundra",
    label: "Tundra",
    terrain: {
      // Flat snowy plains with low drifts: low amp + moderate freq keep the
      // field gently rolling; a low sandLevel exposes frozen ground/ice in the
      // low drift pockets; rockSlope at default shows rock only on the rare
      // steeper bumps. Pale snow palette (grass=snow, sand=frozen ground).
      noiseAmp: 3,
      noiseFreq: 0.014,
      sandLevel: -1,
      rockSlope: 0.9,
      colorRoad: 0x8a8a8a,
      colorGrass: 0xd8e0d8,
      colorSand: 0xc2b280,
      colorRock: 0x9aa0a8,
    },
    flora: TUNDRA_FLORA,
    weather: TUNDRA_WEATHER,
    waterColor: 0xb8d0d8,
    waterLevel: -4,
    skyFogBias: { fogTint: 0xd8dde0, skyTint: 0xb8c4cc },
  },
  tropical: {
    id: "tropical",
    label: "Tropical",
    terrain: {
      // Lush jungle read: moderate rolling relief (mid amp + moderate freq)
      // keeps the field green-dominant; a low sandLevel exposes pale warm sand
      // in low pockets; rockSlope just above default keeps mossy rock to the
      // steeper grades so vivid grass dominates. Vivid green palette, pale warm
      // sand, mossy rock; palms/ferns read, shallow teal warm water.
      noiseAmp: 8,
      noiseFreq: 0.014,
      sandLevel: -2,
      rockSlope: 1.1,
      colorRoad: 0x5e5a3e,
      colorGrass: 0x3f8a3a,
      colorSand: 0xc8b87a,
      colorRock: 0x6a7a5a,
    },
    flora: TROPICAL_FLORA,
    weather: TROPICAL_WEATHER,
    waterColor: 0x8fcfc0,
    waterLevel: -2,
    skyFogBias: { fogTint: 0xb8c8a0, skyTint: 0x3a7ad8 },
  },
};

/**
 * Max big props placed per streamed chunk. Validator + streaming budget share
 * this single source. Shipped big-sums: temperate 3, desert 4, alpine 5,
 * tundra 5, tropical 4; 8 leaves headroom for denser future biomes.
 */
export const MAX_BIG_PROPS_PER_CHUNK = 8;

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
