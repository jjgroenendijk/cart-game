/**
 * 023 signed origin-centered infinite chunk grid helpers. Chunk (gx, gz) is
 * centered at world (gx*chunkSize, gz*chunkSize) and spans
 * [gx*chunkSize - chunkSize/2, gx*chunkSize + chunkSize/2] on each axis.
 * gx,gz are signed integers (negatives allowed). Tiling is seamless: chunk
 * gx's max edge == chunk gx+1's min edge, so neighbours never gap.
 *
 * chunkCoord maps a world XZ point to its nearest containing chunk via
 * Math.round (round-half-up), so a point at +0.6*chunkSize lands in chunk 1
 * while a point at -chunkSize lands in chunk -1. desiredChunks is the union
 * over camera foci (1P = one cam, 2P = two cams) of every chunk key whose
 * center is within radius (Euclidean, XZ plane, Y ignored) of at least one
 * focus — that is the streaming driver's desired-set source
 * (TerrainChunkManager follow-on).
 *
 * streamGrid is pure (numbers in, plain coords/keys/Sets out) and runs under
 * jsdom. Bounds are spatial-only (no segX/segZ): LOD segment counts live in
 * terrainLod, so this module stays decoupled from LOD tiers.
 */

import type { Pt } from "../kart/kartLod";

/** Signed integer chunk coordinate on the infinite grid. */
export interface GridCoord {
  gx: number;
  gz: number;
}

/**
 * Chunk key "gx,gz". MUST match TerrainChunkManager.key exactly so the
 * streaming driver's desired-set keys line up with its active-set keys.
 */
export function chunkKey(gx: number, gz: number): string {
  return gx + "," + gz;
}

/**
 * Inverse of {@link chunkKey}: "gx,gz" -> { gx, gz }. Splits on the first comma
 * so negative gz ("3,-2") parses correctly. Pure.
 */
export function parseChunkKey(key: string): GridCoord {
  const i = key.indexOf(",");
  return { gx: Number(key.slice(0, i)), gz: Number(key.slice(i + 1)) };
}

/**
 * Nearest chunk containing (worldX, worldZ). Round-half-up via Math.round so
 * points on a chunk edge resolve deterministically. Pure.
 */
export function chunkCoord(worldX: number, worldZ: number, chunkSize: number): GridCoord {
  return { gx: Math.round(worldX / chunkSize), gz: Math.round(worldZ / chunkSize) };
}

/** Spatial (XZ) extent of chunk (gx, gz). No LOD segment counts. */
export interface ChunkBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** XZ extent of chunk (gx, gz) for the given chunkSize. Pure. */
export function chunkBounds(gx: number, gz: number, chunkSize: number): ChunkBounds {
  const cx = gx * chunkSize;
  const cz = gz * chunkSize;
  const half = chunkSize / 2;
  return { x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half };
}

/** Center (XZ) of chunk (gx, gz): { x: gx*chunkSize, z: gz*chunkSize }. */
export function chunkCenter(gx: number, gz: number, chunkSize: number): { x: number; z: number } {
  return { x: gx * chunkSize, z: gz * chunkSize };
}

/**
 * Union over ALL foci of every chunk key whose center is within radius
 * (Euclidean, XZ plane, Y ignored) of at least one focus. Empty foci -> empty
 * Set. For each focus the scan window is the bounding box
 * [floor((fx-radius)/chunkSize) .. ceil((fx+radius)/chunkSize)] on each axis,
 * and a chunk is included iff its center's distance to the NEAREST focus is
 * <= radius. Keys are produced via chunkKey. Pure.
 */
export function desiredChunks(foci: readonly Pt[], radius: number, chunkSize: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < foci.length; i++) {
    const f = foci[i]!;
    const fx = f.x;
    const fz = f.z;
    const gxMin = Math.floor((fx - radius) / chunkSize);
    const gxMax = Math.ceil((fx + radius) / chunkSize);
    const gzMin = Math.floor((fz - radius) / chunkSize);
    const gzMax = Math.ceil((fz + radius) / chunkSize);
    for (let gx = gxMin; gx <= gxMax; gx++) {
      for (let gz = gzMin; gz <= gzMax; gz++) {
        const cx = gx * chunkSize;
        const cz = gz * chunkSize;
        const d = nearestFocusDistanceXZ(cx, cz, foci);
        if (d <= radius) out.add(chunkKey(gx, gz));
      }
    }
  }
  return out;
}

/** Min Euclidean (XZ, Y ignored) distance from (x,z) to any focus, or Infinity. Pure. */
export function nearestFocusDistanceXZ(x: number, z: number, foci: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < foci.length; i++) {
    const f = foci[i]!;
    const dx = x - f.x;
    const dz = z - f.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return best;
}
