import { hashSeed, makeRNG } from "../../core/rng";
import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "../../terrain/heightmap";
import type { BiomeDefinition, BiomeId } from "./definition";
import { TEMPERATE } from "./temperate/biome";
import { DESERT } from "./desert/biome";
import { ALPINE } from "./alpine/biome";
import { TUNDRA } from "./tundra/biome";
import { TROPICAL } from "./tropical/biome";

export type { BiomeDefinition, BiomeId, BiomeWeather, FloraEntry } from "./definition";

/**
 * All registered biomes. Each biome lives in its own `src/environment/biomes/<id>/` dir:
 * `biome.ts` (definition) + `flora.ts` (builders) + AGENTS.md (art/vibe
 * guide link). Register a new biome by adding its dir and APPENDING here AND
 * to {@link BIOME_ORDER}.
 */
export const BIOMES: Readonly<Record<BiomeId, BiomeDefinition>> = {
  temperate: TEMPERATE,
  desert: DESERT,
  alpine: ALPINE,
  tundra: TUNDRA,
  tropical: TROPICAL,
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
 * this list is the stable field encoded in circuit codes: a stored index
 * always maps back to the same biome. Reordering entries silently remaps
 * every shared circuit code in the wild; new biomes MUST be APPENDED here
 * AND in {@link BIOMES}. Kept in sync with `Object.keys(BIOMES)` (pinned by
 * tests).
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
