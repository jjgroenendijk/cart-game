import type { BiomeDefinition, BiomeWeather, FloraEntry } from "../definition";

/**
 * Mixed painted woodland, per streamed chunk: branching oaks + slim birches
 * with the occasional dark pine spire breaking the canopy line; meadow decor
 * gains knee-high tall-grass tufts. Big-prop sum 6 (cap 8).
 */
const TEMPERATE_FLORA: ReadonlyArray<FloraEntry> = [
  { kind: "tree", count: 2 },
  { kind: "birch", count: 2 },
  { kind: "forestPine", count: 1 },
  { kind: "rock", count: 1 },
  { kind: "bush", count: 3 },
  { kind: "tallGrass", count: 10 },
  { kind: "flower", count: 20 },
  { kind: "grass", count: 40 },
];

const TEMPERATE_WEATHER: BiomeWeather = {
  clear: 0.7,
  rain: 0.15,
  snow: 0.15,
};

/**
 * Temperate: the parity baseline. Empty terrain overrides + all optionals
 * undefined, so `biomeTerrain(temperate)` is bit-identical to
 * DEFAULT_TERRAIN_CONFIG and sky/fog/track keep default behavior.
 * Art + vibe guide: `docs/knowledge/biomes/temperate.md`.
 */
export const TEMPERATE: BiomeDefinition = {
  id: "temperate",
  label: "Temperate",
  terrain: {},
  flora: TEMPERATE_FLORA,
  weather: TEMPERATE_WEATHER,
};
