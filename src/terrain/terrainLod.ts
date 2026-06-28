/**
 * 019 per-chunk distance LOD. Pure mapping from a chunk's distance to the
 * nearest active camera to a band ("near" | "mid" | "far") used to pick that
 * chunk's per-side segment count. Default bands: <50 m near (highest detail,
 * ~2 chunks); 50-110 m mid (~4-5 chunks); >110 m far. ~25 m hysteresis
 * (~chunkSize) keeps a chunk's tier stable when it sits on a band edge so its
 * geometry is not rebuilt every frame.
 *
 * terrainLod is pure (numbers in, plain tier out) and runs under jsdom.
 * nearestChunkCameraDistance is pure so the 1P (one cam) vs 2P split (two cams)
 * "min across active cameras" rule is unit-testable without WebGL, mirroring
 * kartLod.nearestCameraDistance. Renderer.applyTerrainLod is the per-frame
 * entry point; segmentTier resolves a chunk's segment count keyed off the
 * quality tier (low drops near->mid globally so low-end drops verts globally).
 */

import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";

export type TerrainLodTier = "near" | "mid" | "far";

export interface TerrainLodOpts {
  near?: number;
  mid?: number;
  hysteresis?: number;
}

export const DEFAULT_TERRAIN_LOD: Required<TerrainLodOpts> = {
  near: 50,
  mid: 110,
  hysteresis: 25,
};

/**
 * Resolve a chunk's LOD tier from its distance to the nearest camera. With no
 * prevTier, uses raw thresholds: < near -> near; < mid -> mid; else far. With
 * prevTier set, applies hysteresis at each threshold so the tier cannot flap
 * when the chunk sits on a band edge: near holds until near + hys; mid holds
 * between near - hys and mid + hys; far holds until mid - hys. Pure.
 */
export function chunkLod(
  distance: number,
  prevTier?: TerrainLodTier,
  opts?: TerrainLodOpts,
): TerrainLodTier {
  const near = opts?.near ?? DEFAULT_TERRAIN_LOD.near;
  const mid = opts?.mid ?? DEFAULT_TERRAIN_LOD.mid;
  const hysteresis = opts?.hysteresis ?? DEFAULT_TERRAIN_LOD.hysteresis;
  let tier: TerrainLodTier;
  if (prevTier === undefined) {
    tier = distance < near ? "near" : distance < mid ? "mid" : "far";
  } else if (prevTier === "near") {
    tier = distance < near + hysteresis ? "near" : distance < mid ? "mid" : "far";
  } else if (prevTier === "mid") {
    tier = distance < near - hysteresis ? "near" : distance > mid + hysteresis ? "far" : "mid";
  } else {
    tier = distance > mid - hysteresis ? "far" : distance < near ? "near" : "mid";
  }
  return tier;
}

/**
 * Min Euclidean distance from a chunk center to any camera in cams, or Infinity
 * when cams is empty. Lets the "nearest of 1P (one cam) or 2P split (two cams)"
 * rule live in a pure, WebGL-free helper. Pure.
 */
export function nearestChunkCameraDistance(center: Pt, cams: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i]!;
    const dx = center.x - c.x;
    const dy = center.y - c.y;
    const dz = center.z - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Per-chunk-side segment count keyed off quality tier + LOD band. high/med:
 * near 25 (1/m), mid 20, far 12. low drops near->mid globally (near caps at
 * 12; mid/far not quality-capped) so low-end drops near verts. Throws on an
 * unknown lod so a bad value fails loudly. Pure.
 */
export function segmentTier(tier: QualityTier, lod: TerrainLodTier): number {
  const low = tier === "low";
  switch (lod) {
    case "near":
      return low ? 12 : 25;
    case "mid":
      return 20;
    case "far":
      return 12;
    default: {
      const l: string = lod;
      throw new Error(`segmentTier: unknown lod: ${l}`);
    }
  }
}
