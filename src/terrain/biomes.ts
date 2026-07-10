import { hashSeed, makeRNG } from "../core/rng";
import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "./heightmap";
import type { TrackTraits } from "./trackTraits";

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
  /**
   * Optional shallow-water tint (sRGB hex); undefined = CelWaterMaterial
   * shader default (identity).
   */
  waterShallow?: number;
  /**
   * Optional deep-water tint (sRGB hex); undefined = CelWaterMaterial shader
   * default (identity).
   */
  waterDeep?: number;
  /**
   * Optional sky/fog/light tint bias for the biome. All fields optional;
   * undefined = identity (temperate leaves it unset). Lerps the just-written
   * dayCycleState colors per frame; default factor is BIOME_TINT_FACTOR.
   */
  skyFogBias?: Readonly<{
    fogTint?: number;
    /** Applied to both zenith + horizon (existing behavior; desert/alpine/tundra). */
    skyTint?: number;
    /** Optional separate zenith tint (overrides skyTint for zenith when set). */
    skyZenithTint?: number;
    /** Optional separate horizon tint (overrides skyTint for horizon when set). */
    skyHorizonTint?: number;
    /** Optional sun-light tint bias (warm). */
    sunTint?: number;
    /** Optional ambient-light tint bias (warm). */
    ambientTint?: number;
    /** Optional per-biome bias strength (default BIOME_TINT_FACTOR 0.2). */
    factor?: number;
  }>;
  /** Optional ambient wildlife kind names (later commit). */
  wildlife?: ReadonlyArray<string>;
  /**
   * Optional track character OVERRIDES (059/060): width band + variation,
   * branch chance + kind bias. undefined = DEFAULT_TRACK_TRAITS parity.
   */
  track?: Readonly<Partial<TrackTraits>>;
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

/** Tropical biome flora: palm-forward golden-hour shore (palms + warm blooms). */
const TROPICAL_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "palm", count: 4 },
  { kind: "jungleRock", count: 2 },
  { kind: "fernShrub", count: 3 },
  { kind: "tropicalFlower", count: 8 },
  { kind: "seaOats", count: 12 },
  { kind: "hibiscus", count: 4 },
];

/** Tropical weather weights: dry/warm (clear-dominant, light warm rain). */
const TROPICAL_WEATHER: BiomeWeather = {
  clear: 0.7,
  warmRain: 0.2,
  rain: 0.1,
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
    // Broad open desert highways: wide, calm width, power layouts over
    // near-flat dunes, occasional scenic loop.
    track: {
      widthMin: 6,
      widthMax: 10.5,
      widthVariation: 0.5,
      branchChance: 0.5,
      branchBias: "scenic",
      elevationScale: 0.6,
      archetypeWeights: { classic: 1, flow: 1.5, technical: 1, power: 2 },
    },
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
    // Narrow mountain passes that pinch hard and climb hard: technical
    // hairpin layouts with a real ascent; shortcut forks reward nerve.
    track: {
      widthMin: 4,
      widthMax: 6.5,
      widthVariation: 0.9,
      branchChance: 0.9,
      branchBias: "shortcut",
      elevationScale: 1.7,
      hillBias: 0.6,
      archetypeWeights: { classic: 1, flow: 0.5, technical: 3, power: 0 },
    },
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
    // Steady snow-plain roads: wide-ish, gentle breathing, flowing sweeper
    // laps over rolling drifts; forks are rare.
    track: {
      widthMin: 5.5,
      widthMax: 9,
      widthVariation: 0.45,
      branchChance: 0.35,
      elevationScale: 0.9,
      archetypeWeights: { classic: 1, flow: 2.5, technical: 1, power: 1 },
    },
  },
  tropical: {
    id: "tropical",
    label: "Tropical",
    terrain: {
      // Bright golden-hour palm shore, sand-dominant: moderate rolling relief
      // (mid amp + moderate freq) kept as-is; a high sandLevel exposes bright
      // warm sand across the shore near water; rockSlope just above default
      // keeps warm rock to the steeper grades so sun-bleached grass + sand
      // dominate. Warm beach palette, bright warm sand, warm rock; palms/ferns
      // read, shallow teal warm water.
      noiseAmp: 8,
      noiseFreq: 0.014,
      sandLevel: 2,
      rockSlope: 1.1,
      colorRoad: 0x9a8258,
      colorGrass: 0x8fae5a,
      colorSand: 0xe8c896,
      colorRock: 0x9a7a55,
    },
    flora: TROPICAL_FLORA,
    weather: TROPICAL_WEATHER,
    waterColor: 0x8fcfc0,
    waterShallow: 0x2db8b8,
    waterDeep: 0x0a3a55,
    waterLevel: -2,
    skyFogBias: {
      fogTint: 0xffb488,
      skyHorizonTint: 0xffc78a,
      skyZenithTint: 0x3a5aa8,
      sunTint: 0xffd0a0,
      ambientTint: 0xffd9b0,
      factor: 0.28,
    },
    // Twisty jungle trails: narrow, restless width, technical/flowing
    // layouts under the canopy, forks are common.
    track: {
      widthMin: 4.5,
      widthMax: 8,
      widthVariation: 1.0,
      branchChance: 1.2,
      elevationScale: 1.1,
      archetypeWeights: { classic: 1, flow: 1.5, technical: 2.5, power: 0.5 },
    },
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
 * Stable, APPEND-ONLY biome index registry. The position of a biome id in
 * this list is the stable field encoded in circuit codes (task 058): a stored
 * index always maps back to the same biome. Reordering entries silently
 * remaps every shared circuit code in the wild; new biomes MUST be APPENDED
 * here AND in {@link BIOMES}. Kept in sync with `Object.keys(BIOMES)`
 * (pinned by tests).
 */
export const BIOME_ORDER: readonly BiomeId[] = [
  "temperate",
  "desert",
  "alpine",
  "tundra",
  "tropical",
];

/**
 * Resolve a biome by its stable {@link BIOME_ORDER} index. Out-of-range, NaN,
 * or non-integer indices fall back to temperate (never throws), mirroring
 * {@link resolveBiome}. Resolves a stored circuit-code biome index back to
 * its biome definition.
 */
export function biomeByIndex(index: number): BiomeDefinition {
  if (Number.isInteger(index) && index >= 0 && index < BIOME_ORDER.length) {
    const def = BIOMES[BIOME_ORDER[index]!];
    if (def !== undefined) return def;
  }
  return BIOMES[DEFAULT_BIOME_ID]!;
}

/**
 * Return the stable {@link BIOME_ORDER} index of `id`. Unknown ids resolve to
 * `0` (temperate), mirroring the degrade-to-default contract. Converts a
 * {@link selectBiome} result (or any biome id) to the index encoded in a
 * circuit code.
 */
export function biomeIndexOf(id: BiomeId): number {
  const idx = BIOME_ORDER.indexOf(id);
  return idx === -1 ? 0 : idx;
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
