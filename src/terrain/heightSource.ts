/**
 * 019 height source abstraction. Chunks are BUILT from a height source, not
 * owners of height truth. The chunk layer never imports SplineFieldCache
 * directly — it consumes a HeightSource. v1 binds the world-global heightmap
 * fns; a future streaming track supplies its own HeightSource.
 *
 * Pure interface + a thin adapter; no THREE/Rapier/WebGL.
 */

import {
  SplineFieldCache,
  heightAt,
  colorAt,
  heightFromField,
  colorFromField,
  type TerrainConfig,
  type FieldSample,
} from "./heightmap";
import type { SplineTrack } from "./SplineTrack";
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

/**
 * Streaming height source: extends height/color queries to infinity. In-bounds
 * (inside the SplineFieldCache extent) it reuses the bounded cache -> O(1)
 * bilinear, byte-identical to WorldHeightSource. Out-of-bounds it falls back
 * to SplineTrack.closestPoint -> O(samples=1024) per query, but only far,
 * low-LOD chunk verts hit that path so the cost stays bounded. Both paths
 * resolve a {dist, pathY} sample then feed the SAME heightFromField /
 * colorFromField cores as the global heightmap fns, so the surface is
 * seamless across the old world boundary (no step, no formula drift).
 * worldMax is derived from the cache extent (min + (n-1)*cell).
 *
 * Scratch aliasing: heightAt uses hSample, colorAt uses cSample. colorAt's
 * internal hAt callable routes through this.heightAt -> hSample, so cSample
 * (the outer color sample) is never clobbered. Two distinct buffers are
 * required; sharing one would let heightAt overwrite colorAt's sample.
 */
export class StreamingHeightSource implements HeightSource {
  private readonly worldMax: number;
  private readonly hSample: FieldSample = { dist: 0, pathY: 0 };
  private readonly cSample: FieldSample = { dist: 0, pathY: 0 };

  constructor(
    private readonly cache: SplineFieldCache,
    private readonly track: SplineTrack,
    private readonly cfg: TerrainConfig,
    private readonly noise: SimplexNoise2D,
  ) {
    this.worldMax = cache.min + (cache.n - 1) * cache.cell;
  }

  private inBounds(x: number, z: number): boolean {
    return x >= this.cache.min && x <= this.worldMax && z >= this.cache.min && z <= this.worldMax;
  }

  /** Resolve {dist, pathY}: cache.query in-bounds, else track.closestPoint. */
  private sample(x: number, z: number, out: FieldSample): FieldSample {
    if (this.inBounds(x, z)) return this.cache.query(x, z, out);
    const cp = this.track.closestPoint(x, z);
    out.dist = cp.dist;
    out.pathY = cp.pathY;
    return out;
  }

  heightAt(x: number, z: number): number {
    const s = this.sample(x, z, this.hSample);
    return heightFromField(s, x, z, this.cfg, this.noise);
  }

  colorAt(x: number, z: number, out: Rgb = [0, 0, 0]): Rgb {
    const s = this.sample(x, z, this.cSample);
    // hAt routes through this.heightAt -> hSample; cSample is untouched.
    return colorFromField(s, x, z, this.cfg, this.noise, (px, pz) => this.heightAt(px, pz), out);
  }

  normalAt(x: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
    return normalFromHeight(x, z, (px, pz) => this.heightAt(px, pz), out);
  }
}
