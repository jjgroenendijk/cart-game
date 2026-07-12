import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Tundra flora, per streamed chunk: tall snow-capped pines over drifted
 * plains, a dark dead spruce, pale erratic boulders + ice rocks, snow
 * bushes + frost tufts below. Big-prop sum 7 (cap 8).
 */
const TUNDRA_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "pine", count: 3 },
  { kind: "deadSpruce", count: 1 },
  { kind: "iceRock", count: 2 },
  { kind: "erratic", count: 1 },
  { kind: "snowBush", count: 16 },
  { kind: "frostTuft", count: 10 },
];

/** Tundra weather weights: clear, snow-heavy, occasional blizzard. */
const TUNDRA_WEATHER: BiomeWeather = {
  clear: 0.5,
  snow: 0.35,
  blizzard: 0.15,
};

/**
 * Tundra: the nordic register (cold mist, low pale sun). Art + vibe guide:
 * `docs/knowledge/biomes/tundra.md`.
 */
export const TUNDRA: BiomeDefinition = {
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
};
