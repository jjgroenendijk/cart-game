import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Badlands flora, per streamed chunk: squat juniper spires between big
 * red-rock buttes, low dry scrub, and sparse straw tufts. Big-prop sum 5
 * (2 juniper + 3 butteRock; cap 8).
 */
const BADLANDS_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "juniper", count: 2 },
  { kind: "butteRock", count: 3 },
  { kind: "scrubBrush", count: 20 },
  { kind: "dryTuft", count: 14 },
];

/** Badlands weather weights: mostly clear, rare sandstorm, trace heatHaze. */
const BADLANDS_WEATHER: BiomeWeather = {
  clear: 0.8,
  sandstorm: 0.15,
  heatHaze: 0.05,
};

/**
 * Badlands: sun-baked red-rock canyon country. Eroded mesas, slot canyons,
 * dust, and dry scrub over rust-red sandstone — no water. Art + vibe guide:
 * `docs/knowledge/biomes/badlands.md`.
 */
export const BADLANDS: BiomeDefinition = {
  id: "badlands",
  label: "Badlands",
  // Tall, choppy canyon relief: high amp + more octaves carve the mesas;
  // rust-red rock reads on steep slopes, tan sand fills the washes.
  terrain: {
    noiseAmp: 16,
    noiseFreq: 0.009,
    noiseOctaves: 4,
    rockSlope: 0.5,
    sandLevel: -2,
    colorRoad: 0x8a5a3e,
    colorGrass: 0x9c7a4a,
    colorSand: 0xd8a878,
    colorRock: 0xa0442c,
  },
  flora: BADLANDS_FLORA,
  weather: BADLANDS_WEATHER,
  waterLevel: -100,
  // Fog + sky HORIZON share the dusty tan hue so distant mesas dissolve into
  // haze; the zenith warms to a red-rock glow, cooling only at the top band.
  skyFogBias: { fogTint: 0xd8a878, skyHorizonTint: 0xd88a5a, skyZenithTint: 0x8fa8c0 },
  // Tight, twisting canyon runs: narrower than the desert highway, technical
  // layouts favoured, generous branching for slot-canyon shortcuts.
  track: {
    widthMin: 5,
    widthMax: 8.5,
    widthVariation: 0.7,
    branchChance: 0.7,
    branchBias: "balanced",
    elevationScale: 0.9,
    archetypeWeights: { classic: 1, flow: 1, technical: 1.5, power: 1 },
  },
};
