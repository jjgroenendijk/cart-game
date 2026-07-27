import type { DressingChunkManagerOptions } from "./DressingChunkManager";
import { type FloraKind, type PropLayer } from "./propSampler";
import { floraFor } from "./floraRegistry";
import { degToRad } from "../core/math";

export interface DressingOptions {
  chunkSize?: number;
  streamRadius?: number;
  cullRadius?: number;
  maxActivations?: number;
  baseSeed?: number;
  bigPropBuckets?: number;
  counts?: Partial<Record<FloraKind, number>>;
  cell?: number;
  /** Prop colliders build only within this distance of a kart focus (202). */
  colliderRadius?: number;
  /** Prop colliders removed beyond this distance (hysteresis). Default Infinity. */
  colliderCullRadius?: number;
  /** Decor density falloff knobs (201); default derived from stream/cull radii. */
  densityNearRadius?: number;
  densityFarRadius?: number;
  densityMin?: number;
  densityBands?: number;
  densityHysteresis?: number;
}

const DEFAULT_DRESSING_COUNTS: Record<FloraKind, number> = {
  tree: 2,
  birch: 2,
  forestPine: 1,
  rock: 1,
  bush: 3,
  tallGrass: 10,
  flower: 20,
  grass: 40,
};

/**
 * Minimum cloud domain half-width. Matches the day fog-far horizon (~360) so
 * the cloud field always spans the full visible sky even on small worlds; the
 * recycle boundary then sits in (or past) the horizon haze, never in clear view.
 */
export const CLOUD_HORIZON_HALF = 340;

/**
 * Build the DressingChunkManager config. Kind-agnostic: derives the layer list
 * from the counts table's keys (mirrors PropField.buildSamplerOptions). A
 * supplied counts table FULLY REPLACES the temperate defaults so a
 * non-temperate biome dresses ONLY its own kinds (no temperate bleed); no
 * counts at all falls back to DEFAULT_DRESSING_COUNTS (temperate parity).
 */
export function buildDressingConfig(opts?: DressingOptions): DressingChunkManagerOptions {
  const counts = opts?.counts ?? DEFAULT_DRESSING_COUNTS;
  const maxSlope = degToRad(35);
  // Object.keys preserves insertion order for string keys, so the kind order
  // is the counts insertion order (temperate: tree,rock,bush,flower,grass ->
  // bit-identical layer order; a biome's flora order is preserved too).
  const layers: PropLayer[] = Object.keys(counts).map((kind) => {
    const builder = floraFor(kind);
    return {
      kind,
      count: counts[kind]!,
      minScale: 0.8,
      maxScale: 1.2,
      // Decor tolerates steeper ground than big props.
      maxSlope: builder.big ? maxSlope : maxSlope + degToRad(25),
      // Cluster recipe (e.g. palm groves) is a property of the kind.
      ...(builder.cluster ? { cluster: builder.cluster } : {}),
    };
  });
  return {
    chunkSize: opts?.chunkSize ?? 25,
    streamRadius: opts?.streamRadius ?? 140,
    cullRadius: opts?.cullRadius ?? 170,
    maxActivations: opts?.maxActivations ?? 4,
    colliderRadius: opts?.colliderRadius,
    colliderCullRadius: opts?.colliderCullRadius,
    densityNearRadius: opts?.densityNearRadius,
    densityFarRadius: opts?.densityFarRadius,
    densityMin: opts?.densityMin,
    densityBands: opts?.densityBands,
    densityHysteresis: opts?.densityHysteresis,
    baseSeed: opts?.baseSeed ?? 1337,
    bigPropBuckets: opts?.bigPropBuckets ?? 1,
    layers,
    sampler: {
      cell: opts?.cell ?? 6,
      maxAttemptsPerCell: 4,
      corridorMargin: 3,
      spawnExclusionRadius: 12,
      maxSlope,
    },
  };
}
