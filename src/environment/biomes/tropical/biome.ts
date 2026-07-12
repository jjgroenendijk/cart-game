import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Tropical flora, per streamed chunk: towering leaning palm groves with a
 * rare kapok giant anchoring the treeline, warm rocks, and layered shore
 * decor (ferns, broadleaf clumps, blooms, sea oats). Big-prop sum 7 (cap 8).
 */
const TROPICAL_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "palm", count: 4 },
  { kind: "kapok", count: 1 },
  { kind: "jungleRock", count: 2 },
  { kind: "fernShrub", count: 3 },
  { kind: "broadleaf", count: 5 },
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

/**
 * Tropical: golden-hour palm shore. Art + vibe guide:
 * `docs/knowledge/biomes/tropical.md`.
 */
export const TROPICAL: BiomeDefinition = {
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
};
