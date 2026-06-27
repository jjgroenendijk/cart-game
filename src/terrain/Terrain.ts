import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { makeCel } from "../materials/cel";
import { addOutline } from "../materials/outline";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  heightAt,
  DEFAULT_TERRAIN_CONFIG,
  type TerrainConfig,
} from "./heightmap";
import { SimplexNoise2D } from "./noise";
import { TerrainChunkManager } from "./TerrainChunkManager";
import { WorldHeightSource, normalFromHeight } from "./heightSource";
import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";

const SOLID_LAYER = 0;
const PROP_OUTLINE = 0.004;
const WALL_COLOR = 0x8a6d3b;

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
}

/**
 * 019 chunked terrain: a TerrainChunkManager over a WorldHeightSource tiles
 * the world into a grid of layer-1 CelMaterial meshes, each paired with a
 * Rapier trimesh collider whose verts match the mesh by construction (one
 * HeightSource feeds both). heightAt/normalAt/waterLevel/spline/startPos stay
 * world-global (unchanged from the pre-019 single-mesh terrain); update(cameras)
 * resolves each chunk's near/mid/far LOD band + rebuilds on tier change;
 * dispose frees every chunk body + geometry, the boundary wall meshes + bodies,
 * and the shared materials. Boundary walls stay a single shared mesh set on
 * layer 0 (inverted-hull outline).
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
  private readonly physics: PhysicsWorld;
  private readonly cache: SplineFieldCache;
  private readonly noise: SimplexNoise2D;
  private readonly cfg: TerrainConfig;
  private readonly worldSize: number;
  private readonly src: WorldHeightSource;
  private readonly wallMaterial: THREE.Material;
  private readonly walls: THREE.Mesh[] = [];
  private readonly wallBodies: RAPIER.RigidBody[] = [];

  constructor(physics: PhysicsWorld, opts: TerrainOptions = {}) {
    const worldSize = opts.worldSize ?? 200;
    const cacheCell = opts.cacheCell ?? 2;
    const gridCount = opts.gridCount ?? 8;
    const quality = opts.quality ?? "high";
    this.physics = physics;
    this.worldSize = worldSize;
    this.cfg = { ...DEFAULT_TERRAIN_CONFIG, ...opts.config };
    this.spline = new SplineTrack(opts.control);
    this.cache = new SplineFieldCache(this.spline, worldSize / 2, cacheCell);
    this.noise = new SimplexNoise2D(this.cfg.noiseSeed);
    this.src = new WorldHeightSource(this.cache, this.cfg, this.noise);
    this.chunks = new TerrainChunkManager(physics, this.src, {
      worldSize,
      gridCount,
      quality,
    });
    this.group.add(this.chunks.group);
    this.wallMaterial = makeCel({ color: WALL_COLOR });
    this.buildBoundaryWall(physics);
  }

  heightAt(x: number, z: number): number {
    return heightAt(x, z, this.cache, this.cfg, this.noise);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    // Share the central-difference math with the chunk layer (normalFromHeight)
    // so mesh normals and the values Terrain reports to prop/wildlife callers
    // can never drift apart.
    const n = normalFromHeight(x, z, (px, pz) =>
      heightAt(px, pz, this.cache, this.cfg, this.noise),
    );
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
    for (let i = 0; i < this.walls.length; i++) {
      this.group.remove(this.walls[i]!);
      this.walls[i]!.geometry.dispose();
      this.physics.world.removeRigidBody(this.wallBodies[i]!);
    }
    this.walls.length = 0;
    this.wallBodies.length = 0;
    this.wallMaterial.dispose();
    this.group.clear();
  }

  private buildBoundaryWall(physics: PhysicsWorld): void {
    const half = this.worldSize / 2 - 1;
    const thickness = 2;
    const height = 3;
    const defs: Array<{ x: number; z: number; sx: number; sz: number }> = [
      { x: 0, z: -half, sx: half * 2, sz: thickness },
      { x: 0, z: half, sx: half * 2, sz: thickness },
      { x: -half, z: 0, sx: thickness, sz: half * 2 },
      { x: half, z: 0, sx: thickness, sz: half * 2 },
    ];
    for (const d of defs) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(d.x, height / 2, d.z),
      );
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(d.sx / 2, height / 2, d.sz / 2)
          .setFriction(0.9)
          .setRestitution(0),
        body,
      );
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.sx, height, d.sz), this.wallMaterial);
      mesh.position.set(d.x, height / 2, d.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.set(SOLID_LAYER);
      addOutline(mesh, PROP_OUTLINE);
      this.group.add(mesh);
      this.walls.push(mesh);
      this.wallBodies.push(body);
    }
  }
}
