import type { SplineTrack } from "./SplineTrack";
import { DEFAULT_TRACK_HALF_WIDTH, TrackGraph, type GraphPose } from "./trackGraph";
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
  trackHalfWidth: DEFAULT_TRACK_HALF_WIDTH,
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
  /** Corridor half-width at the nearest path point (m); absent = cfg constant. */
  halfWidth?: number;
}

/**
 * Runtime nearest-path pose {dist, t, halfWidth} for race/AI queries (replaces
 * the O(samples) SplineTrack.closestPoint scan on the hot path). dist is a
 * plain bilinear (== query().dist); t is wrap-aware (see queryPose).
 */
export interface FieldPose {
  /** Horizontal (XZ) distance to the nearest path point (bilinear, O(1)). */
  dist: number;
  /** Arc-length param t in [0,1) of the nearest path point (wrap-aware bilinear). */
  t: number;
  /** Corridor half-width at the nearest path point (m, bilinear). */
  halfWidth: number;
}

/**
 * Uniform world grid of {dist, pathY, t} sampled once from SplineTrack at build
 * time. Turns the O(N) closestPoint scan into an O(1) bilinear query so the
 * ~40k per-vertex heightAt calls (mesh + heightfield) stay fast, and the
 * per-kart race/AI pose queries (dist + loop param t) stay O(1) too.
 *
 * Grid is row-major: index = j * n + i, where i steps world X and j steps Z,
 * matching PlaneGeometry's vertex order ( Terrain ).
 */
export class SplineFieldCache {
  readonly min: number;
  readonly cell: number;
  readonly n: number;
  /** The graph this cache was baked from (single edge when built from a track). */
  readonly graph: TrackGraph;
  private readonly dist: Float32Array;
  private readonly pathY: Float32Array;
  private readonly t: Float32Array;
  private readonly hw: Float32Array;
  private readonly edge: Int32Array;
  /** Pooled queryPose scratch (weights + corner indices; no alloc per call). */
  private readonly poseW = new Float64Array(4);
  private readonly poseK = new Int32Array(4);

  constructor(source: SplineTrack | TrackGraph, worldHalf = 100, cell = 1) {
    this.min = -worldHalf;
    this.cell = cell;
    this.n = Math.floor((2 * worldHalf) / cell) + 1;
    this.dist = new Float32Array(this.n * this.n);
    this.pathY = new Float32Array(this.n * this.n);
    this.t = new Float32Array(this.n * this.n);
    this.hw = new Float32Array(this.n * this.n);
    this.edge = new Int32Array(this.n * this.n);
    // A bare SplineTrack wraps into a single-edge constant-width graph; the
    // mainline edge aliases the track's sample table, so the bake below fills
    // dist/pathY/t exactly as the pre-graph nearest-sample bake did.
    this.graph = source instanceof TrackGraph ? source : new TrackGraph(source);
    const pose: GraphPose = {
      edgeId: 0,
      s: 0,
      dist: 0,
      t: 0,
      halfWidth: 0,
      pathY: 0,
    };
    for (let j = 0; j < this.n; j++) {
      const z = this.min + j * cell;
      for (let i = 0; i < this.n; i++) {
        const x = this.min + i * cell;
        this.graph.closestOnGraph(x, z, pose);
        const k = j * this.n + i;
        this.dist[k] = pose.dist;
        this.pathY[k] = pose.pathY;
        this.t[k] = pose.t;
        this.hw[k] = pose.halfWidth;
        this.edge[k] = pose.edgeId;
      }
    }
  }

  /** O(1) bilinear sample of {dist, pathY, halfWidth} at world (x, z). */
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
    const k00 = j0 * this.n + i0;
    const k10 = j0 * this.n + i1;
    const k01 = j1 * this.n + i0;
    const k11 = j1 * this.n + i1;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    out.dist =
      this.dist[k00]! * w00 + this.dist[k10]! * w10 + this.dist[k01]! * w01 + this.dist[k11]! * w11;
    out.pathY =
      this.pathY[k00]! * w00 +
      this.pathY[k10]! * w10 +
      this.pathY[k01]! * w01 +
      this.pathY[k11]! * w11;
    out.halfWidth =
      this.hw[k00]! * w00 + this.hw[k10]! * w10 + this.hw[k01]! * w01 + this.hw[k11]! * w11;
    return out;
  }

  /**
   * O(1) bilinear {dist, t, halfWidth} for runtime race/AI pose queries.
   * dist is a plain bilinear (identical to query().dist). t and halfWidth are
   * SAME-EDGE bilinears (060): the corner with the largest weight names the
   * reference edge, weights renormalize over corners baked from that edge,
   * and t unwraps at the 0/1 seam relative to the reference corner before
   * blending. Blending t across DIFFERENT edges would average a mainline t
   * with a branch's projected t — two unrelated lap fractions — and corrupt
   * progress right where routes run closest.
   *
   * Single-edge worlds renormalize over all four corners (sum-1 weights), so
   * 059 behavior is unchanged. A cell (~cell m) never spans half the loop,
   * so the +/-0.5 unwrap window always picks the short way around.
   */
  queryPose(x: number, z: number, out: FieldPose = { dist: 0, t: 0, halfWidth: 0 }): FieldPose {
    const max = this.n - 1;
    const fi = (x - this.min) / this.cell;
    const fj = (z - this.min) / this.cell;
    const i0 = clampFloor(fi, max);
    const j0 = clampFloor(fj, max);
    const i1 = Math.min(i0 + 1, max);
    const j1 = Math.min(j0 + 1, max);
    const tx = clamp01(fi - i0);
    const ty = clamp01(fj - j0);
    const w = this.poseW;
    w[0] = (1 - tx) * (1 - ty);
    w[1] = tx * (1 - ty);
    w[2] = (1 - tx) * ty;
    w[3] = tx * ty;
    const k = this.poseK;
    k[0] = j0 * this.n + i0;
    k[1] = j0 * this.n + i1;
    k[2] = j1 * this.n + i0;
    k[3] = j1 * this.n + i1;
    out.dist =
      this.dist[k[0]!]! * w[0]! +
      this.dist[k[1]!]! * w[1]! +
      this.dist[k[2]!]! * w[2]! +
      this.dist[k[3]!]! * w[3]!;
    // Reference corner = largest weight (the corner the query sits nearest).
    let ref = 0;
    for (let c = 1; c < 4; c++) if (w[c]! > w[ref]!) ref = c;
    const refEdge = this.edge[k[ref]!]!;
    const tRef = this.t[k[ref]!]!;
    let sumW = 0;
    let tAcc = 0;
    let hwAcc = 0;
    for (let c = 0; c < 4; c++) {
      if (this.edge[k[c]!] !== refEdge) continue;
      const wc = w[c]!;
      sumW += wc;
      tAcc += unwrapT(this.t[k[c]!]!, tRef) * wc;
      hwAcc += this.hw[k[c]!]! * wc;
    }
    let tt = tAcc / sumW;
    tt -= Math.floor(tt);
    out.t = tt;
    out.halfWidth = hwAcc / sumW;
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
 * Height from a resolved field sample {dist, pathY}: pathY on-track, pathY +
 * blended hills off-track. Pure core of heightAt so a streaming source can
 * supply the sample (cache in-bounds, closestPoint out-of-bounds) and share
 * the exact same formula -> seamless across the world boundary.
 */
export function heightFromField(
  s: FieldSample,
  x: number,
  z: number,
  cfg: TerrainConfig,
  noise: SimplexNoise2D,
): number {
  const hw = s.halfWidth ?? cfg.trackHalfWidth;
  const w = smoothstep(hw, hw + cfg.blendWidth, s.dist);
  const noiseY = octaveSum(noise, x, z, cfg) * w;
  return s.pathY + noiseY;
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
  return heightFromField(cache.query(x, z), x, z, cfg, noise);
}

/**
 * Per-cfg cached LINEAR conversions of the four constant surface colors.
 * Each entry holds its OWN array (no shared scratch) so blending one color
 * can never corrupt another. Keyed by cfg so the sRGB->LINEAR work happens
 * once per cfg object, not per vertex (colorAt runs per terrain vertex).
 */
export interface CachedColors {
  road: [number, number, number];
  grass: [number, number, number];
  rock: [number, number, number];
  sand: [number, number, number];
}

const linearColorCache = new WeakMap<TerrainConfig, CachedColors>();

/** Returns (lazily building) the per-cfg cached LINEAR surface colors. */
export function cachedColors(cfg: TerrainConfig): CachedColors {
  let c = linearColorCache.get(cfg);
  if (!c) {
    c = {
      road: toLinear(cfg.colorRoad, [0, 0, 0]),
      grass: toLinear(cfg.colorGrass, [0, 0, 0]),
      rock: toLinear(cfg.colorRock, [0, 0, 0]),
      sand: toLinear(cfg.colorSand, [0, 0, 0]),
    };
    linearColorCache.set(cfg, c);
  }
  return c;
}

/**
 * Surface color from a resolved field sample + a height callable. Pure core of
 * colorAt so a streaming source shares the exact same road/grass/rock/sand
 * formula (slope + height come from hAt; the lateral dist comes from s).
 * Constant colors come from cachedColors(cfg): each is its own array, so the
 * road->grass blend reads grass values that the road write cannot have
 * touched.
 */
export function colorFromField(
  s: FieldSample,
  x: number,
  z: number,
  cfg: TerrainConfig,
  _noise: SimplexNoise2D,
  hAt: (x: number, z: number) => number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const eps = 0.5;
  const hL = hAt(x - eps, z);
  const hR = hAt(x + eps, z);
  const hD = hAt(x, z - eps);
  const hU = hAt(x, z + eps);
  const slope = Math.hypot(hR - hL, hU - hD) / (2 * eps);
  const h = hAt(x, z);

  const col = cachedColors(cfg);
  const hw = s.halfWidth ?? cfg.trackHalfWidth;
  if (s.dist < hw) {
    out[0] = col.road[0];
    out[1] = col.road[1];
    out[2] = col.road[2];
    return out;
  }
  const w = smoothstep(hw, hw + cfg.blendWidth, s.dist);
  out[0] = col.road[0];
  out[1] = col.road[1];
  out[2] = col.road[2];
  out[0] += (col.grass[0] - out[0]) * w;
  out[1] += (col.grass[1] - out[1]) * w;
  out[2] += (col.grass[2] - out[2]) * w;
  const rockW = smoothstep(
    cfg.rockSlope - cfg.rockBlendSlope,
    cfg.rockSlope + cfg.rockBlendSlope,
    slope,
  );
  if (rockW > 0) {
    out[0] += (col.rock[0] - out[0]) * rockW;
    out[1] += (col.rock[1] - out[1]) * rockW;
    out[2] += (col.rock[2] - out[2]) * rockW;
  }
  const sandW =
    1 - smoothstep(cfg.sandLevel - cfg.sandBlendHeight, cfg.sandLevel + cfg.sandBlendHeight, h);
  if (sandW > 0) {
    out[0] += (col.sand[0] - out[0]) * sandW;
    out[1] += (col.sand[1] - out[1]) * sandW;
    out[2] += (col.sand[2] - out[2]) * sandW;
  }
  return out;
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
  return colorFromField(
    cache.query(x, z),
    x,
    z,
    cfg,
    noise,
    (px, pz) => heightAt(px, pz, cache, cfg, noise),
    out,
  );
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

/** Shift v by +/-1 so it sits within half a loop of ref (short way around),
 *  for bilinear-blending the closed-loop param t across the 0/1 seam. */
function unwrapT(v: number, ref: number): number {
  const d = v - ref;
  if (d > 0.5) return v - 1;
  if (d < -0.5) return v + 1;
  return v;
}
