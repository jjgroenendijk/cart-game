import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { makeCel } from "../materials/cel";
import { addOutline } from "../materials/outline";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  heightAt,
  colorAt,
  DEFAULT_TERRAIN_CONFIG,
  type TerrainConfig,
} from "./heightmap";
import { SimplexNoise2D } from "./noise";

const TERRAIN_LAYER = 1;
const SOLID_LAYER = 0;
const PROP_OUTLINE = 0.004;
const WALL_COLOR = 0x8a6d3b;

export interface TerrainOptions {
  /** Full world extent in metres (square). */
  worldSize?: number;
  /** Collider + mesh subdivisions per axis (cell count). */
  segments?: number;
  /** SplineFieldCache grid cell size (metres). */
  cacheCell?: number;
  /** Surface/shape config (heights, colors, noise). */
  config?: Partial<TerrainConfig>;
  /** Authored spline control points (defaults to the standard circuit). */
  control?: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * Displaced terrain mesh + matching Rapier trimesh collider, both built from
 * the SAME displaced vertex buffer so physics and visuals agree by
 * construction. The mesh paints road/grass/rock/sand via CelMaterial
 * vertexColors on render layer 1 (post Sobel outline). Exposes
 * heightAt/normalAt + the spline for spawn.
 *
 * Collider note: the 003 plan specified a Rapier heightfield, but Rapier
 * 0.14 heightfield raycasts miss ~60% of downward rays (verified on a flat
 * heightfield), which would break the kart's ray-based suspension. A trimesh
 * built from the identical vertex buffer passes both raycast (0 misses) and
 * contact (box-rest) checks. See docs/troubleshooting/2026-06-21_003.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly spline: SplineTrack;
  readonly mesh: THREE.Mesh;
  readonly collider: RAPIER.Collider;
  private readonly cache: SplineFieldCache;
  private readonly noise: SimplexNoise2D;
  private readonly cfg: TerrainConfig;
  private readonly worldSize: number;

  constructor(physics: PhysicsWorld, opts: TerrainOptions = {}) {
    const worldSize = opts.worldSize ?? 200;
    const segments = opts.segments ?? 200;
    const cacheCell = opts.cacheCell ?? 2;
    this.worldSize = worldSize;
    this.cfg = { ...DEFAULT_TERRAIN_CONFIG, ...opts.config };
    this.spline = new SplineTrack(opts.control);
    this.cache = new SplineFieldCache(this.spline, worldSize / 2, cacheCell);
    this.noise = new SimplexNoise2D(this.cfg.noiseSeed);

    this.mesh = this.buildMesh(segments);
    this.group.add(this.mesh);
    this.collider = this.buildTrimeshCollider(physics);
    this.buildBoundaryWall(physics);
  }

  heightAt(x: number, z: number): number {
    return heightAt(x, z, this.cache, this.cfg, this.noise);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const eps = 0.5;
    const hL = heightAt(x - eps, z, this.cache, this.cfg, this.noise);
    const hR = heightAt(x + eps, z, this.cache, this.cfg, this.noise);
    const hD = heightAt(x, z - eps, this.cache, this.cfg, this.noise);
    const hU = heightAt(x, z + eps, this.cache, this.cfg, this.noise);
    const dx = (hR - hL) / (2 * eps);
    const dz = (hU - hD) / (2 * eps);
    return out.set(-dx, 1, -dz).normalize();
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

  private buildMesh(segments: number): THREE.Mesh {
    const W = this.worldSize;
    const geo = new THREE.PlaneGeometry(W, W, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, heightAt(x, z, this.cache, this.cfg, this.noise));
      colorAt(x, z, this.cache, this.cfg, this.noise, c);
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = makeCel({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.layers.set(TERRAIN_LAYER);
    return mesh;
  }

  private buildTrimeshCollider(physics: PhysicsWorld): RAPIER.Collider {
    // Reuse the mesh's displaced vertex buffer (already in world space, centered
    // at origin) and build an index with upward-facing winding so downward
    // suspension rays hit reliably. Identical vertices -> collider == mesh.
    const geo = this.mesh.geometry as THREE.PlaneGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nX = geo.parameters.widthSegments + 1;
    const nZ = geo.parameters.heightSegments + 1;
    const cells = (nX - 1) * (nZ - 1);
    const indices = new Uint32Array(cells * 6);
    let p = 0;
    for (let iz = 0; iz < nZ - 1; iz++) {
      for (let ix = 0; ix < nX - 1; ix++) {
        const a = iz * nX + ix;
        const b = a + 1;
        const c = a + nX;
        const d = c + 1;
        // (a,c,b) + (b,c,d): upward-facing for a downward ray (verified 0/361).
        indices[p++] = a;
        indices[p++] = c;
        indices[p++] = b;
        indices[p++] = b;
        indices[p++] = c;
        indices[p++] = d;
      }
    }
    const positions = Float32Array.from(pos.array as Float32Array);
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(positions, indices),
      body,
    );
    collider.setFriction(1.0);
    collider.setRestitution(0);
    return collider;
  }

  private buildBoundaryWall(physics: PhysicsWorld): void {
    const half = this.worldSize / 2 - 1;
    const thickness = 2;
    const height = 3;
    const mat = makeCel({ color: WALL_COLOR });
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
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.sx, height, d.sz), mat);
      mesh.position.set(d.x, height / 2, d.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.set(SOLID_LAYER);
      addOutline(mesh, PROP_OUTLINE);
      this.group.add(mesh);
    }
  }
}
