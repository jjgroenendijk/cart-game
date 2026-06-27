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

/**
 * Height + surface color at a world (x, z). One shared fn feeds the chunk
 * mesh vertices + the chunk trimesh colliders so physics/visuals agree by
 * construction (mirrors the global heightAt/colorAt contract).
 */
export interface HeightSource {
  heightAt(x: number, z: number): number;
  colorAt(x: number, z: number, out?: Rgb): Rgb;
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
}
