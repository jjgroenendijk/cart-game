import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  DEFAULT_TERRAIN_CONFIG,
  type FieldPose,
  type TerrainConfig,
} from "./heightmap";
import { SimplexNoise2D } from "./noise";
import { TerrainChunkManager } from "./TerrainChunkManager";
import { StreamingHeightSource } from "./heightSource";
import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";

export interface TerrainOptions {
  /** Full world extent in metres (square). */
  worldSize?: number;
  /** SplineFieldCache grid cell size (metres). */
  cacheCell?: number;
  /** Surface/shape config (heights, colors, noise). */
  config?: Partial<TerrainConfig>;
  /** Authored spline control points (defaults to the standard circuit). */
  control?: ReadonlyArray<readonly [number, number, number]>;
  /** Chunks per axis (grid is gridCount x gridCount). Default 8. */
  gridCount?: number;
  /** Quality tier keys the near chunk segment count. Default "high". */
  quality?: QualityTier;
  /** Streaming: activate chunks within this of any camera. Default 140. */
  streamRadius?: number;
  /** Streaming: deactivate beyond this (hysteresis). Default 170. */
  cullRadius?: number;
  /** Streaming: max new chunk activations per update. Default 4. */
  maxActivations?: number;
}

/**
 * 023 infinite terrain: a TerrainChunkManager over a StreamingHeightSource
 * tiles an INFINITE signed grid of layer-1 cel chunks (near = HEIGHT_MAP,
 * far = vertex normals), each paired with a Rapier trimesh collider whose
 * verts match the mesh by construction (one HeightSource feeds both).
 * heightAt/normalAt delegate to the streaming source (cache in-bounds,
 * closestPoint out-of-bounds) so reported heights agree with the streamed
 * colliders everywhere. No boundary wall: the kart roams past the old world
 * bound into endless procedural hills.
 *
 * Collider note: a per-chunk Rapier trimesh (not a heightfield). Rapier
 * heightfield raycasts still miss ~60% of downward rays on 0.19.3 (verified
 * on a flat heightfield), which would break the kart's ray-based suspension.
 * A trimesh built from the identical vertex buffer passes both raycast
 * (0 misses) and contact (box-rest) checks. See
 * docs/troubleshooting/2026-06-21_003-terrain-heightfield.md.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly spline: SplineTrack;
  readonly chunks: TerrainChunkManager;
  private readonly cache: SplineFieldCache;
  private readonly noise: SimplexNoise2D;
  private readonly cfg: TerrainConfig;
  private readonly src: StreamingHeightSource;

  constructor(physics: PhysicsWorld, opts: TerrainOptions = {}) {
    const worldSize = opts.worldSize ?? 200;
    const cacheCell = opts.cacheCell ?? 2;
    const gridCount = opts.gridCount ?? 8;
    const quality = opts.quality ?? "high";
    this.cfg = { ...DEFAULT_TERRAIN_CONFIG, ...opts.config };
    this.spline = new SplineTrack(opts.control);
    this.cache = new SplineFieldCache(this.spline, worldSize / 2, cacheCell);
    this.noise = new SimplexNoise2D(this.cfg.noiseSeed);
    this.src = new StreamingHeightSource(this.cache, this.spline, this.cfg, this.noise);
    this.chunks = new TerrainChunkManager(physics, this.src, {
      worldSize,
      gridCount,
      quality,
      streamRadius: opts.streamRadius,
      cullRadius: opts.cullRadius,
      maxActivations: opts.maxActivations,
    });
    this.group.add(this.chunks.group);
  }

  heightAt(x: number, z: number): number {
    return this.src.heightAt(x, z);
  }

  /**
   * O(1) cached nearest-path {dist, t} for runtime race/AI pose queries.
   * Replaces the per-kart SplineTrack.closestPoint O(samples) scan on the hot
   * path; dist is bilinear, t is wrap-aware bilinear over the cache grid.
   */
  closestPose(x: number, z: number, out: FieldPose = { dist: 0, t: 0 }): FieldPose {
    return this.cache.queryPose(x, z, out);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.src.normalAt(x, z);
    return out.set(n[0], n[1], n[2]);
  }

  startPos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.spline.startPos(out);
  }

  startYaw(): number {
    return this.spline.startYaw();
  }

  /** Valley water height (003 sandLevel) — the hook 004 water fills to. */
  get waterLevel(): number {
    return this.cfg.sandLevel;
  }

  /** Per-frame LOD pass; delegate to the chunk manager (no-op after dispose). */
  update(cameras: readonly Pt[]): void {
    this.chunks.update(cameras);
  }

  dispose(): void {
    this.chunks.dispose();
    this.group.clear();
  }
}
