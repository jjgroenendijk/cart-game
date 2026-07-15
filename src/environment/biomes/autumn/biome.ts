import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Autumn-forest flora, per streamed chunk: a dense golden/red canopy of
 * broadleaf autumnTrees + limbed autumnOaks over mossy boulders, with a busy
 * mushroom/fern/leaf-litter forest floor. Big-prop sum 8 (at cap).
 */
const AUTUMN_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "autumnTree", count: 4 },
  { kind: "autumnOak", count: 2 },
  { kind: "mossRock", count: 2 },
  { kind: "mushroom", count: 8 },
  { kind: "fern", count: 12 },
  { kind: "leafLitter", count: 24 },
];

/** Autumn weather weights: calm, leaf-fall dominant, occasional soft mist. */
const AUTUMN_WEATHER: BiomeWeather = {
  clear: 0.45,
  leafFall: 0.4,
  fog: 0.15,
};

/**
 * Autumn: an enchanted fairy-tale forest at the turn of the season — golden
 * mystical light, drifting leaves, a mossy floor under a dense turning canopy.
 * Art + vibe guide: `docs/knowledge/biomes/autumn.md`.
 */
export const AUTUMN: BiomeDefinition = {
  id: "autumn",
  label: "Autumn Forest",
  terrain: {
    // Rolling wooded floor: moderate amp + freq keep the ground gently
    // undulating under the canopy. rockSlope stays at the default 0.9 so mossy
    // rock shows on the steeper grades. Amber/gold grass, mossy green-brown
    // rock, warm packed-leaf road, warm-brown soil.
    noiseAmp: 8,
    noiseFreq: 0.012,
    colorRoad: 0x7a5a3a,
    colorGrass: 0xb07a3a,
    colorSand: 0xa07a4a,
    colorRock: 0x6a6a3a,
  },
  flora: AUTUMN_FLORA,
  weather: AUTUMN_WEATHER,
  // Cool desaturated forest streams: a mossy-cool surface with an amber-mossy
  // shallow lift and a deep cool floor, sitting low in the wooded pockets.
  waterColor: 0x7a8a76,
  waterShallow: 0x9aa06a,
  waterDeep: 0x2a3830,
  waterLevel: -3,
  // Soft warm golden diffuse + gentle mist: enchanted mood, modest factor so
  // the cel bands still read (not crushed). Golden horizon over a soft muted
  // blue zenith, warm sun + ambient.
  skyFogBias: {
    fogTint: 0xd8b884,
    skyHorizonTint: 0xe8c88a,
    skyZenithTint: 0x6a7aa8,
    sunTint: 0xffdca8,
    ambientTint: 0xf0d8b0,
    factor: 0.22,
  },
  // Winding forest trails: moderate width, restless a touch, frequent forks,
  // flowing + technical layouts weaving between the trees.
  track: {
    widthMin: 5,
    widthMax: 8.5,
    widthVariation: 0.7,
    branchChance: 0.9,
    elevationScale: 1.0,
    archetypeWeights: { classic: 1, flow: 2, technical: 2, power: 0.5 },
  },
};
