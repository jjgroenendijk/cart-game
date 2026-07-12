import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Alpine flora, per streamed chunk: towering pine spires over dense dark
 * firs, a weathered snag on the granite line, scree below, lichen mats +
 * hardy blooms at ground level. Big-prop sum 8 (at cap).
 */
const ALPINE_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "alpinePine", count: 3 },
  { kind: "fir", count: 2 },
  { kind: "alpineSnag", count: 1 },
  { kind: "screeRock", count: 2 },
  { kind: "lichenBush", count: 20 },
  { kind: "alpineBloom", count: 8 },
];

/** Alpine weather weights: clear, snow-heavy, occasional blizzard. */
const ALPINE_WEATHER: BiomeWeather = {
  clear: 0.55,
  snow: 0.35,
  blizzard: 0.1,
};

/**
 * Alpine: towering granite massifs. Art + vibe guide:
 * `docs/knowledge/biomes/alpine.md`.
 */
export const ALPINE: BiomeDefinition = {
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
};
