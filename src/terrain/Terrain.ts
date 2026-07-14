import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  DEFAULT_TERRAIN_CONFIG,
  type FieldPose,
  type TerrainConfig,
} from "./heightmap";
import {
  TrackGraph,
  type BankProfile,
  type BranchEdgeInit,
  type GraphPose,
  type WidthProfile,
} from "./trackGraph";
import { SimplexNoise2D } from "./noise";
import { TerrainChunkManager } from "./TerrainChunkManager";
import { StreamingHeightSource } from "./heightSource";
import type { Rgb } from "./heightSource";
import type { HeightMapField } from "../materials/cel";
import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";
import { terrainBudgets } from "./terrainLod";

/**
 * Default terrain LOD tier-swap cross-fade duration (seconds). Tuned by feel to
 * roughly match the dressing dither fade; adjust for the fog-band dissolve look.
 */
export const DEFAULT_CROSS_FADE_SECONDS = 0.4;

export interface TerrainOptions {
  /** Full world extent in metres (square). */
  worldSize?: number;
  /** SplineFieldCache grid cell size (metres). */
  cacheCell?: number;
  /** Surface/shape config (heights, colors, noise). */
  config?: Partial<TerrainConfig>;
  /** Authored spline control points (defaults to the standard circuit). */
  control?: ReadonlyArray<readonly [number, number, number]>;
  /** Chunks per axis (grid is gridCount x gridCount). World-size-scaled. */
  gridCount?: number;
  /** Quality tier keys the near chunk segment count. Default "high". */
  quality?: QualityTier;
  /** Streaming: activate chunks within this of any camera. Default 140. */
  streamRadius?: number;
  /** Streaming: deactivate beyond this (hysteresis). Default 170. */
  cullRadius?: number;
  /** Streaming: max new chunk activations per update. Default 4. */
  maxActivations?: number;
  /**
   * Seconds for a chunk LOD tier swap to dither cross-fade instead of snapping
   * (see TerrainChunkManager). Default {@link DEFAULT_CROSS_FADE_SECONDS}; the
   * manager gates it off on the low quality tier. 0 disables (instant swap).
   */
  crossFadeSeconds?: number;
  /** Colliders build only within this distance of a kart focus (202). Default Infinity. */
  colliderRadius?: number;
  /** Colliders disable beyond this distance (hysteresis past colliderRadius). Default Infinity. */
  colliderCullRadius?: number;
  /** Water surface height override; undefined falls back to cfg.sandLevel. */
  waterLevel?: number;
  /** Per-station corridor half-width profile (059); undefined = constant. */
  mainWidth?: WidthProfile;
  /** Per-station mainline bank profile (084); undefined = level roads. */
  mainBank?: BankProfile;
  /** Branch edges (060 split/rejoin); undefined = mainline only. */
  branches?: ReadonlyArray<BranchEdgeInit>;
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
  readonly graph: TrackGraph;
  readonly chunks: TerrainChunkManager;
  private readonly cache: SplineFieldCache;
  private readonly noise: SimplexNoise2D;
  private readonly cfg: TerrainConfig;
  private readonly src: StreamingHeightSource;
  private readonly waterLevelOverride?: number;
  /** Pooled FieldPose for corridorClearance (single-threaded per-query use). */
  private readonly clearancePose: FieldPose = { dist: 0, t: 0, halfWidth: 0 };

  constructor(physics: PhysicsWorld, opts: TerrainOptions = {}) {
    const worldSize = opts.worldSize ?? 200;
    const cacheCell = opts.cacheCell ?? 2;
    const gridCount = opts.gridCount ?? terrainBudgets(worldSize).gridCount;
    const quality = opts.quality ?? "high";
    this.cfg = { ...DEFAULT_TERRAIN_CONFIG, ...opts.config };
    this.waterLevelOverride = opts.waterLevel;
    this.spline = new SplineTrack(opts.control);
    this.graph = new TrackGraph(this.spline, {
      mainWidth: opts.mainWidth ?? this.cfg.trackHalfWidth,
      mainBank: opts.mainBank,
      branches: opts.branches,
    });
    this.cache = new SplineFieldCache(this.graph, worldSize / 2, cacheCell, this.cfg.blendWidth);
    this.noise = new SimplexNoise2D(this.cfg.noiseSeed);
    this.src = new StreamingHeightSource(this.cache, this.cfg, this.noise);
    this.chunks = new TerrainChunkManager(physics, this.src, {
      worldSize,
      gridCount,
      quality,
      streamRadius: opts.streamRadius,
      cullRadius: opts.cullRadius,
      maxActivations: opts.maxActivations,
      colliderRadius: opts.colliderRadius,
      colliderCullRadius: opts.colliderCullRadius,
      crossFadeSeconds: opts.crossFadeSeconds ?? DEFAULT_CROSS_FADE_SECONDS,
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
  closestPose(x: number, z: number, out: FieldPose = { dist: 0, t: 0, halfWidth: 0 }): FieldPose {
    return this.cache.queryPose(x, z, out);
  }

  /**
   * Exact nearest-edge pose {edgeId, s, dist, t, halfWidth, pathY} over the
   * whole track graph (mainline + branches). Edge-local (unlike the bilinear
   * closestPose), so respawn + AI route sampling can continue along the
   * kart's own edge (060).
   */
  graphPose(
    x: number,
    z: number,
    out: GraphPose = { edgeId: 0, s: 0, dist: 0, t: 0, halfWidth: 0, pathY: 0 },
  ): GraphPose {
    return this.graph.closestOnGraph(x, z, out);
  }

  /**
   * Signed lateral clearance from the corridor edge (m): dist - halfWidth at
   * the local road width. <= 0 means on the road. Flora/critter placement
   * excludes by clearance so wide roads stay clear without a literal
   * half-width constant (059).
   */
  corridorClearance(x: number, z: number): number {
    const p = this.cache.queryPose(x, z, this.clearancePose);
    return p.dist - p.halfWidth;
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.src.normalAt(x, z);
    return out.set(n[0], n[1], n[2]);
  }

  /**
   * LINEAR surface color [r,g,b] 0..1 at (x,z). Forwarder mirroring
   * {@link heightAt}/{@link normalAt}; kart VFX (053) tints dust to the local
   * surface so it reads biome-correct (red badlands, white tundra) for free.
   */
  colorAt(x: number, z: number, out: Rgb = [0, 0, 0]): Rgb {
    return this.src.colorAt(x, z, out);
  }

  /**
   * Baked bed-height descriptor over the worldSize square (062). Water reads
   * depth = waterY - bedHeight from this texture. Forwarder mirroring
   * {@link colorAt}; undefined semantics are owned by the chunk manager.
   */
  heightMapField(): HeightMapField {
    return this.chunks.heightMapField();
  }

  startPos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.spline.startPos(out);
  }

  startYaw(): number {
    return this.spline.startYaw();
  }

  /**
   * Water surface height. Defaults to cfg.sandLevel (003 valley band); an
   * explicit waterLevel override (e.g. a biome that needs high sand colour
   * coverage but no visible water) wins. Read by Water placement + kart
   * buoyancy so the visible plane and the buoyancy hook stay consistent.
   */
  get waterLevel(): number {
    return this.waterLevelOverride ?? this.cfg.sandLevel;
  }

  /** Per-frame LOD pass; delegate to the chunk manager (no-op after dispose). */
  update(cameras: readonly Pt[]): void {
    this.chunks.update(cameras);
  }

  /**
   * 202 collider-range pass over the kart/AI foci. Terrain colliders exist only
   * near the karts; the visual update() streams meshes around the camera out to
   * the fog horizon. Called per-frame by Game with all kart positions.
   */
  updateColliders(foci: readonly Pt[]): void {
    this.chunks.refreshColliders(foci);
  }

  dispose(): void {
    this.chunks.dispose();
    this.group.clear();
  }
}
