import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Beach flora, per streamed chunk: a few leaning coconut palms over a broad
 * bright shore, bleached driftwood logs, sea-worn rocks, and low dune decor
 * (dune grass tufts, scattered shells). Big-prop sum 7 (3 palm + 2 driftwood
 * + 2 seaRock; cap 8).
 */
const BEACH_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "palm", count: 3 },
  { kind: "driftwood", count: 2 },
  { kind: "seaRock", count: 2 },
  { kind: "duneGrass", count: 16 },
  { kind: "shell", count: 8 },
];

/** Beach weather: bright clear-heavy, light warm sea rain, trace haze. */
const BEACH_WEATHER: BiomeWeather = {
  clear: 0.78,
  warmRain: 0.12,
  fog: 0.1,
};

/**
 * Beach: bright-midday coast. High sun, near-white warm sand, turquoise
 * shallows over a prominent deep ocean, and an open flowing coastal road —
 * distinct from Tropical's golden-hour amber dusk. Art + vibe guide:
 * `docs/knowledge/biomes/beach.md`.
 */
export const BEACH: BiomeDefinition = {
  id: "beach",
  label: "Beach",
  // Low dune relief over a broad bright shore: small amp + low freq keeps the
  // land gently rolling so the ocean reads as a wide plane beyond the dunes; a
  // high sandLevel exposes near-white warm sand across the whole shore; rock
  // only breaks through on the steepest grades (high rockSlope).
  terrain: {
    noiseAmp: 4,
    noiseFreq: 0.01,
    sandLevel: 3,
    rockSlope: 1.2,
    colorRoad: 0xbfa878,
    colorGrass: 0x9caa66,
    colorSand: 0xe8dcc0,
    colorRock: 0x9a8f7e,
  },
  flora: BEACH_FLORA,
  weather: BEACH_WEATHER,
  // Prominent deep ocean: pale turquoise surface tint, bright turquoise
  // shallows, deep ocean blue at depth (darker than tropical's 0x0a3a55).
  waterColor: 0x9ad8d0,
  waterShallow: 0x1fb6c8,
  waterDeep: 0x06304a,
  // -2 keeps the whole drivable corridor on land (corridor floor ~-1.50) while
  // the low off-track dunes sit near/below the plane -> broad ocean read.
  waterLevel: -2,
  // Bright midday: pale sea-haze fog + horizon, high blue zenith, clean warm
  // sun, cool-neutral ambient. Gentle factor keeps the daylight read.
  skyFogBias: {
    fogTint: 0xdfeaf0,
    skyHorizonTint: 0xcfe6ec,
    skyZenithTint: 0x4a86c8,
    sunTint: 0xfff0d8,
    ambientTint: 0xdfe8ec,
    factor: 0.22,
  },
  // Open flowing coastal road: wide band, calm width breathing, gentle
  // elevation, sweeper-favoured with long straights, few scenic forks.
  track: {
    widthMin: 5.5,
    widthMax: 10,
    widthVariation: 0.4,
    branchChance: 0.4,
    branchBias: "scenic",
    elevationScale: 0.7,
    archetypeWeights: { classic: 1, flow: 2.5, technical: 0.5, power: 1.5 },
  },
};
