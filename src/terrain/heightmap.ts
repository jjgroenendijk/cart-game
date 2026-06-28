import type { SplineTrack } from "./SplineTrack";
import { SimplexNoise2D } from "./noise";

export interface TerrainConfig {
  /** Drivable corridor half-width (on-track surface). */
  trackHalfWidth: number;
  /** Distance over which on-track path height blends into full off-track hills. */
  blendWidth: number;
  /** Simplex octave count for the off-track hills. */
  noiseOctaves: number;
  /** Base spatial frequency for the noise (cycles per metre). */
  noiseFreq: number;
  /** Peak off-track amplitude in metres (at full weight, beyond the blend). */
  noiseAmp: number;
  /** Noise permutation seed (deterministic field). */
  noiseSeed: number;
  /** Below this world height, sand (valleys; hook for 004 water). */
  sandLevel: number;
  /** Half-window of height over which sand blends in around sandLevel. */
  sandBlendHeight: number;
  /** Slope (rise/run) at/above which rock shows through. */
  rockSlope: number;
  /** Half-window of slope over which rock blends in around rockSlope. */
  rockBlendSlope: number;
  /** sRGB hex surface palette (converted to LINEAR for the vertex attribute). */
  colorRoad: number;
  colorGrass: number;
  colorSand: number;
  colorRock: number;
}

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
  trackHalfWidth: 6,
  blendWidth: 8,
  noiseOctaves: 3,
  noiseFreq: 0.012,
  noiseAmp: 7,
  noiseSeed: 1337,
  sandLevel: -3,
  sandBlendHeight: 1.0,
  rockSlope: 0.9,
  rockBlendSlope: 0.15,
  colorRoad: 0x6e6256,
  colorGrass: 0x6aa84f,
  colorSand: 0xc2b280,
  colorRock: 0x7d8a96,
};

export interface FieldSample {
  dist: number;
  pathY: number;
}

/**
 * Uniform world grid of {dist, pathY} sampled once from SplineTrack at build
 * time. Turns the O(N) closestPoint scan into an O(1) bilinear query so the
 * ~40k per-vertex heightAt calls (mesh + heightfield) stay fast.
 *
 * Grid is row-major: index = j * n + i, where i steps world X and j steps Z,
 * matching PlaneGeometry's vertex order ( Terrain ).
 */
export class SplineFieldCache {
  readonly min: number;
  readonly cell: number;
  readonly n: number;
  private readonly dist: Float32Array;
  private readonly pathY: Float32Array;

  constructor(track: SplineTrack, worldHalf = 100, cell = 1) {
    this.min = -worldHalf;
    this.cell = cell;
    this.n = Math.floor((2 * worldHalf) / cell) + 1;
    this.dist = new Float32Array(this.n * this.n);
    this.pathY = new Float32Array(this.n * this.n);
    const r = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 };
    for (let j = 0; j < this.n; j++) {
      const z = this.min + j * cell;
      for (let i = 0; i < this.n; i++) {
        const x = this.min + i * cell;
        track.closestPoint(x, z, r);
        const k = j * this.n + i;
        this.dist[k] = r.dist;
        this.pathY[k] = r.pathY;
      }
    }
  }

  /** O(1) bilinear sample of {dist, pathY} at world (x, z). */
  query(x: number, z: number, out: FieldSample = { dist: 0, pathY: 0 }): FieldSample {
    const max = this.n - 1;
    const fi = (x - this.min) / this.cell;
    const fj = (z - this.min) / this.cell;
    const i0 = clampFloor(fi, max);
    const j0 = clampFloor(fj, max);
    const i1 = Math.min(i0 + 1, max);
    const j1 = Math.min(j0 + 1, max);
    const tx = clamp01(fi - i0);
    const ty = clamp01(fj - j0);
    const d00 = this.dist[j0 * this.n + i0];
    const d10 = this.dist[j0 * this.n + i1];
    const d01 = this.dist[j1 * this.n + i0];
    const d11 = this.dist[j1 * this.n + i1];
    const y00 = this.pathY[j0 * this.n + i0];
    const y10 = this.pathY[j0 * this.n + i1];
    const y01 = this.pathY[j1 * this.n + i0];
    const y11 = this.pathY[j1 * this.n + i1];
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    out.dist = d00 * w00 + d10 * w10 + d01 * w01 + d11 * w11;
    out.pathY = y00 * w00 + y10 * w10 + y01 * w01 + y11 * w11;
    return out;
  }
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Fractal octave sum of simplex noise. Normalized -> ~[-amp, amp]. */
export function octaveSum(noise: SimplexNoise2D, x: number, z: number, cfg: TerrainConfig): number {
  let sum = 0;
  let amp = 1;
  let freq = cfg.noiseFreq;
  let norm = 0;
  for (let o = 0; o < cfg.noiseOctaves; o++) {
    sum += amp * noise.noise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return (sum / norm) * cfg.noiseAmp;
}

/**
 * World height: pathY on-track (w=0 -> smooth corridor), pathY + hills
 * off-track (w=1 past the blend). One shared fn feeds mesh + collider so
 * physics/visuals agree by construction.
 */
export function heightAt(
  x: number,
  z: number,
  cache: SplineFieldCache,
  cfg: TerrainConfig,
  noise: SimplexNoise2D,
): number {
  const s = cache.query(x, z);
  const w = smoothstep(cfg.trackHalfWidth, cfg.trackHalfWidth + cfg.blendWidth, s.dist);
  const noiseY = octaveSum(noise, x, z, cfg) * w;
  return s.pathY + noiseY;
}

/**
 * Surface color (LINEAR rgb in 0..1) by lateral distance + slope. Road is
 * crisp on the corridor; road->grass smoothstep across blendWidth; rock
 * blends in by slope across rockBlendSlope around rockSlope; sand dominates
 * below sandLevel and fades out across sandBlendHeight above. Finite-
 * difference slope uses heightAt so steep procedural hills reveal rock.
 */
export function colorAt(
  x: number,
  z: number,
  cache: SplineFieldCache,
  cfg: TerrainConfig,
  noise: SimplexNoise2D,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const eps = 0.5;
  const hL = heightAt(x - eps, z, cache, cfg, noise);
  const hR = heightAt(x + eps, z, cache, cfg, noise);
  const hD = heightAt(x, z - eps, cache, cfg, noise);
  const hU = heightAt(x, z + eps, cache, cfg, noise);
  const slope = Math.hypot(hR - hL, hU - hD) / (2 * eps);
  const h = heightAt(x, z, cache, cfg, noise);

  const s = cache.query(x, z);
  if (s.dist < cfg.trackHalfWidth) {
    toLinear(cfg.colorRoad, out);
    return out;
  }
  const w = smoothstep(cfg.trackHalfWidth, cfg.trackHalfWidth + cfg.blendWidth, s.dist);
  toLinear(cfg.colorRoad, out);
  const grass = toLinearScratch(cfg.colorGrass);
  out[0] += (grass[0] - out[0]) * w;
  out[1] += (grass[1] - out[1]) * w;
  out[2] += (grass[2] - out[2]) * w;
  const rockW = smoothstep(
    cfg.rockSlope - cfg.rockBlendSlope,
    cfg.rockSlope + cfg.rockBlendSlope,
    slope,
  );
  if (rockW > 0) {
    const rock = toLinearScratch(cfg.colorRock);
    out[0] += (rock[0] - out[0]) * rockW;
    out[1] += (rock[1] - out[1]) * rockW;
    out[2] += (rock[2] - out[2]) * rockW;
  }
  const sandW =
    1 - smoothstep(cfg.sandLevel - cfg.sandBlendHeight, cfg.sandLevel + cfg.sandBlendHeight, h);
  if (sandW > 0) {
    const sand = toLinearScratch(cfg.colorSand);
    out[0] += (sand[0] - out[0]) * sandW;
    out[1] += (sand[1] - out[1]) * sandW;
    out[2] += (sand[2] - out[2]) * sandW;
  }
  return out;
}

const scratchRGB: [number, number, number] = [0, 0, 0];

function toLinearScratch(hex: number): [number, number, number] {
  toLinear(hex, scratchRGB);
  return scratchRGB;
}

/** sRGB hex -> LINEAR working-space rgb (matches three.js ColorManagement). */
function toLinear(hex: number, out: [number, number, number]): [number, number, number] {
  out[0] = srgbToLinear(((hex >> 16) & 0xff) / 255);
  out[1] = srgbToLinear(((hex >> 8) & 0xff) / 255);
  out[2] = srgbToLinear((hex & 0xff) / 255);
  return out;
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Floor + clamp for the bilinear base cell index. Floor (NOT round): round
 *  snaps the sample to the nearest node for half of every cell, so dist/pathY
 *  go flat-then-ramp each cell -> a cell-wide sawtooth. That sawtooth feeds
 *  heightAt (wobbly road surface + terraced mesh), colorAt via dist (wobbly
 *  road edge + stripy terrain), and the heightmap texture. Floor keeps the
 *  base at the lower node and the fraction in [0,1) -> true bilinear. */
function clampFloor(v: number, max: number): number {
  const i = Math.floor(v);
  return i < 0 ? 0 : i > max ? max : i;
}
