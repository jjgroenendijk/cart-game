import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Mediterranean flora, per streamed chunk: cypress spires and pale poplars
 * over sun-bleached limestone, with vineyard rows and lavender filling the
 * golden slopes. Big-prop sum 7 (3 cypress + 2 poplar + 2 oliveRock; cap 8).
 */
const MEDITERRANEAN_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "cypress", count: 3 },
  { kind: "poplar", count: 2 },
  { kind: "oliveRock", count: 2 },
  { kind: "vineRow", count: 10 },
  { kind: "lavender", count: 18 },
];

/**
 * Mediterranean weather: clear-dominant sun, warm haze over the far hills,
 * rare light warm rain. Reuses shipped presets (heatHaze carries the warm
 * shimmer, warmRain the passing shower) — no new preset.
 */
const MEDITERRANEAN_WEATHER: BiomeWeather = {
  clear: 0.75,
  heatHaze: 0.15,
  warmRain: 0.1,
};

/**
 * Mediterranean / Golden Hills: sunlit vineyard country. Golden dry grass over
 * gentle rolling hills, cypress + poplar silhouettes, lavender and vine rows,
 * warm amber haze on the horizon under a deep warm blue zenith. Distinct from
 * Temperate (warmer, drier, golden not green) and from Tropical/Beach (inland
 * hills, no headline water). Art + vibe guide:
 * `docs/knowledge/biomes/mediterranean.md`.
 */
export const MEDITERRANEAN: BiomeDefinition = {
  id: "mediterranean",
  label: "Golden Hills",
  // Gentle rolling hills: low-moderate amp over a LOW frequency, so the land
  // rolls in broad vineyard slopes rather than the tighter temperate lumps.
  // High rockSlope keeps limestone on the steep shoulders only (warm grass
  // dominates); the low sandLevel leaves pale dust to the deepest hollows.
  terrain: {
    noiseAmp: 9,
    noiseFreq: 0.007,
    sandLevel: -5,
    rockSlope: 1.05,
    colorRoad: 0x54452f,
    colorGrass: 0x8a7b2e,
    colorSand: 0xbfa876,
    colorRock: 0x857a60,
  },
  flora: MEDITERRANEAN_FLORA,
  weather: MEDITERRANEAN_WEATHER,
  // Minimal water: warm green-blue stream tint, shallow bed reading clear over
  // stone, a modest deep tint (no ocean depth to sell here).
  waterColor: 0x8fbfae,
  waterShallow: 0x5fae9a,
  waterDeep: 0x1c4a44,
  // -6 sits below sandLevel: water only fills the deepest gullies as streams,
  // leaving the rolling hills and the whole corridor dry.
  waterLevel: -6,
  // Warm golden register: amber horizon + mid-value amber haze fog, deep warm
  // blue zenith, gently warm sun and warm-bounced ambient. Distance is
  // fog-dominated past ~60 m, so the fog tint (not the albedo) is what carries
  // the golden read on far hills; it stays mid-value so haze reads amber rather
  // than bleaching to cream. Light tints stay soft — warm light on warm ground
  // is where value separation is lost first.
  skyFogBias: {
    fogTint: 0xc9a465,
    skyHorizonTint: 0xf0d9a4,
    skyZenithTint: 0x2f6ec2,
    sunTint: 0xffeccb,
    ambientTint: 0xd9c9a8,
    factor: 0.3,
  },
  // Rolling vineyard road: default-ish width band, flowing sweepers over the
  // hills with real elevation and a guaranteed climb per lap, few scenic forks.
  track: {
    widthMin: 4.5,
    widthMax: 9,
    widthVariation: 0.5,
    branchChance: 0.6,
    branchBias: "scenic",
    elevationScale: 1.15,
    hillBias: 0.4,
    archetypeWeights: { classic: 1.2, flow: 2, technical: 0.8, power: 1 },
  },
};
