import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

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

/**
 * Desert: sun-bleached dune field. Art + vibe guide:
 * `docs/knowledge/biomes/desert.md`.
 */
export const DESERT: BiomeDefinition = {
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
    archetypeWeights: { classic: 1, flow: 1.5, technical: 1, power: 1.5 },
  },
};
