/**
 * 019 height source abstraction. Chunks are BUILT from a height source, not
 * owners of height truth. The chunk layer never imports SplineFieldCache
 * directly — it consumes a HeightSource. v1 binds the world-global heightmap
 * fns; a future streaming track supplies its own HeightSource.
 *
 * Pure interface + a thin adapter; no THREE/Rapier/WebGL.
 */

import { SplineFieldCache, heightAt, colorAt, type TerrainConfig } from "./heightmap";
import type { SimplexNoise2D } from "./noise";

/** Color sample out (LINEAR rgb, 0..1, matches heightmap colorAt shape). */
export type Rgb = [number, number, number];

/** Unit surface normal sample out (xyz). THREE-free so chunks stay pure. */
export type Vec3 = [number, number, number];

/**
 * Compute a smooth surface normal at (x, z) from a height callable via central
 * differences. Pure (no THREE/WebGL), so chunks, Terrain.normalAt, and unit
 * tests all share one definition -> border normals match exactly across chunk
 * seams. `eps` matches Terrain.normalAt's historical 0.5 m radius.
 */
export function normalFromHeight(
  x: number,
  z: number,
  hAt: (x: number, z: number) => number,
  out: Vec3 = [0, 0, 0],
  eps = 0.5,
): Vec3 {
  const hL = hAt(x - eps, z);
  const hR = hAt(x + eps, z);
  const hD = hAt(x, z - eps);
  const hU = hAt(x, z + eps);
  const dx = (hR - hL) / (2 * eps);
  const dz = (hU - hD) / (2 * eps);
  // n = normalize((-dx, 1, -dz)).
  const ny = 1;
  const len = Math.hypot(dx, ny, dz);
  out[0] = -dx / len;
  out[1] = ny / len;
  out[2] = -dz / len;
  return out;
}

/**
 * Height + surface normal + surface color at a world (x, z). One shared fn
 * feeds the chunk mesh vertices + the chunk trimesh colliders so physics/
 * visuals agree by construction (mirrors the global heightAt/colorAt
 * contract). normalAt lets chunks author world-consistent normals so adjacent
 * chunk borders shade identically (no per-chunk computeVertexNormals seams).
 */
export interface HeightSource {
  heightAt(x: number, z: number): number;
  colorAt(x: number, z: number, out?: Rgb): Rgb;
  normalAt(x: number, z: number, out?: Vec3): Vec3;
}

/**
 * Adapter binding the world-global SplineFieldCache + TerrainConfig + noise to
 * the HeightSource interface (v1). Future streaming track supplies its own.
 */
export class WorldHeightSource implements HeightSource {
  constructor(
    private readonly cache: SplineFieldCache,
    private readonly cfg: TerrainConfig,
    private readonly noise: SimplexNoise2D,
  ) {}

  heightAt(x: number, z: number): number {
    return heightAt(x, z, this.cache, this.cfg, this.noise);
  }

  colorAt(x: number, z: number, out: Rgb = [0, 0, 0]): Rgb {
    return colorAt(x, z, this.cache, this.cfg, this.noise, out);
  }

  normalAt(x: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
    return normalFromHeight(x, z, (px, pz) => this.heightAt(px, pz), out);
  }
}
