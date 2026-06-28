import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { makeCel, type HeightMapField } from "../materials/cel";
import { buildChunk, buildSkirt, type ChunkGeometry, type ChunkRect } from "./chunkBuilder";
import type { HeightSource } from "./heightSource";
import {
  chunkLod,
  nearestChunkCameraDistance,
  segmentTier,
  DEFAULT_TERRAIN_LOD,
  type TerrainLodTier,
  type TerrainLodOpts,
} from "./terrainLod";
import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";

const TERRAIN_LAYER = 1;

export interface TerrainChunkManagerOptions {
  /** Full world extent in metres (square). Default 200. */
  worldSize?: number;
  /** Chunks per axis (grid is gridCount x gridCount). Default 8. */
  gridCount?: number;
  /** Quality tier keys the near segment count. Default "high". */
  quality?: QualityTier;
  /** Skirt vertical drop (metres, positive), below chunk terrain edge. Default 30. */
  skirtDrop?: number;
  /** LOD band + hysteresis opts. Default DEFAULT_TERRAIN_LOD. */
  lod?: TerrainLodOpts;
  /**
   * Heightmap texels per axis used for per-pixel terrain normals (square).
   * Default 384. The texture spans worldSize, so each texel is
   * worldSize/texels metres. Finer than the chunk mesh resolution so the
   * fragment-shader normal is smooth and independent of the quad
   * triangulation (no diagonal/diamond cel-band artifacts).
   */
  heightTexels?: number;
}

interface ChunkState {
  gx: number;
  gz: number;
  rect: ChunkRect;
  center: Pt;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  tier: TerrainLodTier;
}

function mergeGeometry(base: ChunkGeometry, skirt: ChunkGeometry): ChunkGeometry {
  const baseVerts = base.positions.length / 3;
  const positions = new Float32Array(base.positions.length + skirt.positions.length);
  positions.set(base.positions, 0);
  positions.set(skirt.positions, base.positions.length);
  const colors = new Float32Array(base.colors.length + skirt.colors.length);
  colors.set(base.colors, 0);
  colors.set(skirt.colors, base.colors.length);
  const normals = new Float32Array(base.normals.length + skirt.normals.length);
  normals.set(base.normals, 0);
  normals.set(skirt.normals, base.normals.length);
  const indices = new Uint32Array(base.indices.length + skirt.indices.length);
  indices.set(base.indices, 0);
  const offset = base.indices.length;
  for (let i = 0; i < skirt.indices.length; i++) {
    indices[offset + i] = skirt.indices[i]! + baseVerts;
  }
  return { positions, colors, normals, indices };
}

/**
 * 019 streaming-capable terrain chunk manager. Active chunk set keyed by grid
 * coord: activate builds a layer-1 mesh + Rapier trimesh body (verts identical
 * by construction per chunk), deactivate removes both, update resolves each
 * chunk's LOD tier from its distance to the nearest camera (hysteresis) and
 * rebuilds on tier change, dispose frees all bodies + geometries + the shared
 * material. v1 activates all in-world chunks (bounded world); a streaming
 * radius around a focus point is a follow-on.
 *
 * Mesh geometry merges buildChunk + buildSkirt (skirt is visual-only, seals
 * LOD-band cracks between tiers); the collider uses buildChunk only (the
 * driving surface) so the kart's suspension rays hit the same verts the mesh
 * paints. One shared CelMaterial (vertexColors) renders every chunk on layer
 * 1, matching the pre-019 single-mesh look.
 */
export class TerrainChunkManager {
  readonly group = new THREE.Group();

  private readonly physics: PhysicsWorld;
  private readonly src: HeightSource;
  private readonly worldSize: number;
  private readonly gridCount: number;
  private readonly quality: QualityTier;
  private readonly skirtDrop: number;
  private readonly lod: Required<TerrainLodOpts>;
  private readonly chunkSize: number;
  private readonly material: THREE.Material;
  private readonly heightMap: THREE.DataTexture;
  private readonly chunks = new Map<string, ChunkState>();
  private disposed = false;

  constructor(physics: PhysicsWorld, src: HeightSource, opts: TerrainChunkManagerOptions = {}) {
    this.physics = physics;
    this.src = src;
    this.worldSize = opts.worldSize ?? 200;
    this.gridCount = opts.gridCount ?? 8;
    this.quality = opts.quality ?? "high";
    this.skirtDrop = opts.skirtDrop ?? 30;
    this.lod = { ...DEFAULT_TERRAIN_LOD, ...opts.lod };
    this.chunkSize = this.worldSize / this.gridCount;
    this.heightMap = buildHeightTexture(src, this.worldSize, opts.heightTexels ?? 384);
    this.material = makeCel({
      vertexColors: true,
      heightMap: this.heightMapDescriptor(),
      cel: false,
    });
    for (let gz = 0; gz < this.gridCount; gz++) {
      for (let gx = 0; gx < this.gridCount; gx++) {
        this.activate(gx, gz, "near");
      }
    }
  }

  get activeCount(): number {
    return this.chunks.size;
  }

  activate(gx: number, gz: number, tier: TerrainLodTier = "near"): void {
    const built = this.buildAt(gx, gz, tier);
    const mesh = new THREE.Mesh(built.geometry, this.material);
    mesh.receiveShadow = true;
    mesh.layers.set(TERRAIN_LAYER);
    this.group.add(mesh);
    this.chunks.set(this.key(gx, gz), {
      gx,
      gz,
      rect: built.rect,
      center: built.center,
      mesh,
      body: built.body,
      tier,
    });
  }

  deactivate(gx: number, gz: number): void {
    const k = this.key(gx, gz);
    const state = this.chunks.get(k);
    if (!state) return;
    this.group.remove(state.mesh);
    state.mesh.geometry.dispose();
    this.physics.world.removeRigidBody(state.body);
    this.chunks.delete(k);
  }

  update(cameras: readonly Pt[]): void {
    if (this.disposed) return;
    for (const state of this.chunks.values()) {
      const d = nearestChunkCameraDistance(state.center, cameras);
      const newTier = chunkLod(d, state.tier, this.lod);
      if (newTier !== state.tier) this.rebuild(state, newTier);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const state of this.chunks.values()) {
      this.group.remove(state.mesh);
      state.mesh.geometry.dispose();
      this.physics.world.removeRigidBody(state.body);
    }
    this.chunks.clear();
    this.material.dispose();
    this.heightMap.dispose();
    this.group.clear();
  }

  private key(gx: number, gz: number): string {
    return gx + "," + gz;
  }

  /** {@link HeightMapField} view over the shared height texture + world bounds. */
  private heightMapDescriptor(): HeightMapField {
    const origin = -this.worldSize / 2;
    return {
      texture: this.heightMap,
      origin: [origin, origin],
      size: this.worldSize,
      texels: this.heightMap.image.height as number,
    };
  }

  private buildSegmentRect(gx: number, gz: number, tier: TerrainLodTier): ChunkRect {
    const worldHalf = this.worldSize / 2;
    const x0 = -worldHalf + gx * this.chunkSize;
    const z0 = -worldHalf + gz * this.chunkSize;
    const seg = segmentTier(this.quality, tier);
    return { x0, z0, x1: x0 + this.chunkSize, z1: z0 + this.chunkSize, segX: seg, segZ: seg };
  }

  private buildAt(
    gx: number,
    gz: number,
    tier: TerrainLodTier,
  ): { rect: ChunkRect; center: Pt; geometry: THREE.BufferGeometry; body: RAPIER.RigidBody } {
    const rect = this.buildSegmentRect(gx, gz, tier);
    const chunk = buildChunk(rect, this.src);
    const skirt = buildSkirt(rect, this.src, this.skirtDrop);
    const merged = mergeGeometry(chunk, skirt);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(merged.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(merged.colors, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(merged.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(merged.indices, 1));
    // Normals come straight from the HeightSource (world-consistent central
    // differences), NOT computeVertexNormals: per-chunk averaging over
    // duplicated border verts would disagree with the neighbour chunk and the
    // cel bands would split the terrain into a visible grid.
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    const center: Pt = { x: cx, y: this.src.heightAt(cx, cz), z: cz };
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(chunk.positions, chunk.indices),
      body,
    );
    collider.setFriction(1.0);
    collider.setRestitution(0);
    return { rect, center, geometry, body };
  }

  private rebuild(state: ChunkState, newTier: TerrainLodTier): void {
    state.mesh.geometry.dispose();
    this.physics.world.removeRigidBody(state.body);
    const built = this.buildAt(state.gx, state.gz, newTier);
    state.mesh.geometry = built.geometry;
    state.body = built.body;
    state.rect = built.rect;
    state.tier = newTier;
  }
}

/**
 * Bake the world heightfield into a square float DataTexture for the
 * CelMaterial per-pixel normal path. Texel (i,j) centre sits at world
 * (origin + (i+0.5)/N*size, origin + (j+0.5)/N*size); height is stored in the
 * red channel (rgba float so any single-channel format quirk is avoided).
 * Nearest filtering: the shader finite-differences neighbours itself, so no
 * float-linear filtering support is required.
 */
function buildHeightTexture(
  src: HeightSource,
  worldSize: number,
  texels: number,
): THREE.DataTexture {
  const data = new Float32Array(texels * texels * 4);
  const origin = -worldSize / 2;
  const step = worldSize / texels;
  let p = 0;
  for (let j = 0; j < texels; j++) {
    const z = origin + (j + 0.5) * step;
    for (let i = 0; i < texels; i++) {
      const x = origin + (i + 0.5) * step;
      const h = src.heightAt(x, z);
      data[p] = h;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 1;
      p += 4;
    }
  }
  const tex = new THREE.DataTexture(data, texels, texels, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
