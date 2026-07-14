import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { CelMaterial, HeightMapField } from "../materials/cel";
import { buildFarCel, buildNearCel, type FadeMode } from "./terrainCelMaterials";
import { defaultNow, removeOutgoing, stepCrossFade, type CrossFade } from "./chunkCrossFade";
import { buildChunk, buildSkirt, type ChunkGeometry, type ChunkRect } from "./chunkBuilder";
import type { HeightSource } from "./heightSource";
import {
  chunkLod,
  nearestChunkCameraDistance,
  segmentTier,
  terrainBudgets,
  DEFAULT_TERRAIN_LOD,
  type TerrainLodTier,
  type TerrainLodOpts,
} from "./terrainLod";
import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";
import {
  chunkBounds,
  chunkCenter,
  chunkKey,
  desiredChunks,
  nearestFocusDistanceXZ,
} from "./streamGrid";
import { planStream, type StreamPolicy } from "./chunkStream";

const TERRAIN_LAYER = 1;

/** Origin fallback collider focus until refreshColliders supplies the karts. */
const ORIGIN_FOCUS: readonly Pt[] = [{ x: 0, y: 0, z: 0 }];

/** Inverse of {@link chunkKey}: "gx,gz" -> { gx, gz }. Module-private. */
function parseKey(key: string): { gx: number; gz: number } {
  const i = key.indexOf(",");
  return { gx: Number(key.slice(0, i)), gz: Number(key.slice(i + 1)) };
}

export interface TerrainChunkManagerOptions {
  /** Full world extent in metres (square). Default 200. */
  worldSize?: number;
  /** Chunks per axis (grid is gridCount x gridCount). World-size-scaled. */
  gridCount?: number;
  /** Quality tier keys the near segment count. Default "high". */
  quality?: QualityTier;
  /** Skirt vertical drop (metres, positive), below chunk terrain edge. Default 30. */
  skirtDrop?: number;
  /** LOD band + hysteresis opts. Default DEFAULT_TERRAIN_LOD. */
  lod?: TerrainLodOpts;
  /**
   * Heightmap texels per axis used for per-pixel terrain normals (square).
   * World-size-scaled (clamp(pow2ish(worldSize*1.4),384,1024)). The texture
   * spans worldSize, so each texel is worldSize/texels metres. Finer than the
   * chunk mesh resolution so the fragment-shader normal is smooth and
   * independent of the quad triangulation (no diagonal/diamond cel-band
   * artifacts).
   */
  heightTexels?: number;
  /** Activate chunks within this distance of any camera focus. Default 140. */
  streamRadius?: number;
  /** Deactivate chunks beyond this distance (hysteresis past streamRadius). Default 170. */
  cullRadius?: number;
  /** Max new chunk activations per update() (hitch budget). Default 4. */
  maxActivations?: number;
  /**
   * 202 collider-range decoupling. A chunk builds its trimesh collider only
   * while its center is within colliderRadius (XZ) of a collider focus (kart/AI
   * position, passed to refreshColliders); the collider is disabled once the
   * center passes colliderCullRadius (hysteresis). The per-chunk fixed body is
   * always created (it is near-free without an enabled collider), so bodyCount
   * still equals activeCount; only the trimesh BVH + broadphase presence is
   * gated. Visual streaming keeps using streamRadius/cullRadius around the
   * camera, so terrain renders out to the fog horizon while colliders stay
   * bounded near the karts. Both default to Infinity -> every active chunk
   * keeps its collider (pre-202 coupled behavior).
   */
  colliderRadius?: number;
  colliderCullRadius?: number;
  /**
   * Seconds for a chunk's LOD tier swap to dither cross-fade (old tier OUT /
   * new tier IN through the fog band) instead of snapping. Default 0 = instant
   * swap. Gated off on the low tier (budget: transient double draw + discard).
   */
  crossFadeSeconds?: number;
  /** Monotonic clock (SECONDS) for frame-rate-independent fades. Tests inject it. */
  now?: () => number;
}

interface ChunkState {
  gx: number;
  gz: number;
  rect: ChunkRect;
  center: Pt;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  tier: TerrainLodTier;
  /**
   * Per-tier trimesh colliders sharing `body`. Only the `tier` entry is
   * enabled; others are lazy-built on first transition then cached so a tier
   * change toggles setEnabled instead of remove/recreate (no mid-frame BVH
   * rebuild). removeRigidBody frees every collider attached to `body`.
   */
  colliders: Map<TerrainLodTier, RAPIER.Collider>;
  /**
   * 202: whether this chunk currently has an enabled trimesh collider (its
   * center is within collider range of a focus). When false the chunk renders
   * without physics; tier changes only touch geometry until it re-enters range.
   */
  collidersOn: boolean;
  /** Active LOD cross-fade, if the chunk is mid tier swap (crossFadeSeconds>0). */
  xfade?: CrossFade;
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
 * 023 streaming terrain chunk manager over a SIGNED origin-centered grid
 * (streamGrid helpers): chunk (gx,gz) is signed (negatives allowed) and
 * centered at world (gx*chunkSize, gz*chunkSize). The ctor seeds every chunk
 * within streamRadius of the origin. update(cameras) then streams:
 * 1+2. chunk-key selection via the shared 071 planStream planner — deactivate
 *    active chunks past cullRadius of every camera (hysteresis past streamRadius
 *    so an edge chunk does not flap), activate desired-not-active chunks inside
 *    streamRadius nearest-first, capped at maxActivations new bodies per update
 *    (hitch budget). 3. resolve each surviving chunk's LOD tier from its 3D
 *    distance to the nearest camera (hysteresis) and, on tier change, either
 *    snap geometry (rebuild) or dither cross-fade it (crossFadeSeconds>0, high/
 *    med tier — old tier out / new tier in, see chunkCrossFade). LOD stays local
 *    (planner is LOD-agnostic, XZ-only); the pre-cached per-tier collider
 *    toggles via setEnabled (no BVH rebuild). dispose frees everything.
 *
 * Two-material cel split (terrainCelMaterials): materialNear (HEIGHT_MAP over
 * worldSize, where the baked height texture has data) renders chunks fully
 * inside the near/cache region; materialFar (vertexColors, vertex normals)
 * renders streamed chunks outside it. A chunk's material family is stable
 * (gx,gz fixed). Mesh + collider verts stay identical by construction (buildChunk
 * feeds both); out-of-bounds StreamingHeightSource resolves the nearest track
 * sample via the TrackGraph (cache.graph.closestOnGraph).
 */
export class TerrainChunkManager {
  readonly group = new THREE.Group();

  private readonly physics: PhysicsWorld;
  private readonly src: HeightSource;
  private readonly worldSize: number;
  private readonly gridCount: number;
  private readonly quality: QualityTier;
  private detailQuality: QualityTier;
  private readonly skirtDrop: number;
  private readonly lod: Required<TerrainLodOpts>;
  private readonly chunkSize: number;
  private materialNear: CelMaterial;
  private readonly materialFar: THREE.Material;
  private readonly heightMap: THREE.DataTexture;
  private readonly policy: StreamPolicy;
  private readonly colliderRadius: number;
  private readonly colliderCullRadius: number;
  private readonly crossFadeSeconds: number;
  private readonly now: () => number;
  private lastNow: number;
  /** Latest collider foci (karts/AI); ORIGIN_FOCUS until refreshColliders runs. */
  private colliderFoci: readonly Pt[] = ORIGIN_FOCUS;
  private readonly chunks = new Map<string, ChunkState>();
  private disposed = false;

  constructor(physics: PhysicsWorld, src: HeightSource, opts: TerrainChunkManagerOptions = {}) {
    this.physics = physics;
    this.src = src;
    this.worldSize = opts.worldSize ?? 200;
    this.gridCount = opts.gridCount ?? terrainBudgets(this.worldSize).gridCount;
    this.quality = opts.quality ?? "high";
    this.detailQuality = this.quality;
    this.skirtDrop = opts.skirtDrop ?? 30;
    this.lod = { ...DEFAULT_TERRAIN_LOD, ...opts.lod };
    this.chunkSize = this.worldSize / this.gridCount;
    this.policy = {
      chunkSize: this.chunkSize,
      streamRadius: opts.streamRadius ?? 140,
      cullRadius: opts.cullRadius ?? 170,
      maxActivations: opts.maxActivations ?? 4,
    };
    this.colliderRadius = opts.colliderRadius ?? Infinity;
    this.colliderCullRadius = opts.colliderCullRadius ?? Infinity;
    this.crossFadeSeconds = opts.crossFadeSeconds ?? 0;
    this.now = opts.now ?? defaultNow;
    this.lastNow = this.now();
    this.heightMap = buildHeightTexture(
      src,
      this.worldSize,
      opts.heightTexels ?? terrainBudgets(this.worldSize).heightTexels,
    );
    // 069 surface detail (shading-only, tier-gated) lives in the near material
    // builder (terrainCelMaterials); runtime tier changes replace this shared
    // material, geometry untouched. Low is byte-identical to pre-069.
    this.materialNear = this.createNearMaterial(this.detailQuality);
    this.materialFar = buildFarCel();
    const seed = desiredChunks([{ x: 0, y: 0, z: 0 }], this.policy.streamRadius, this.chunkSize);
    for (const key of seed) {
      const { gx, gz } = parseKey(key);
      const c = chunkCenter(gx, gz, this.chunkSize);
      const d = Math.hypot(c.x, c.z);
      const tier = chunkLod(d, undefined, this.lod);
      this.activate(gx, gz, tier);
    }
    // The chunk group is parented once and never transformed again ->
    // freeze its matrix so the renderer skips its per-frame compose.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  get activeCount(): number {
    return this.chunks.size;
  }

  activate(gx: number, gz: number, tier: TerrainLodTier = "near"): void {
    const built = this.buildChunkMesh(gx, gz, tier);
    const mesh = this.addChunkMesh(built.geometry, this.materialFor(gx, gz));
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const colliders = new Map<TerrainLodTier, RAPIER.Collider>();
    // 202: build the trimesh collider only if the chunk is within collider range
    // of a focus; else the chunk renders body-only, collider lazily built when
    // refreshColliders brings a kart into range.
    const collidersOn = this.withinColliderRange(built.center);
    if (collidersOn) {
      colliders.set(tier, this.createTierCollider(gx, gz, tier, body, true));
    }
    this.chunks.set(this.key(gx, gz), {
      gx,
      gz,
      rect: built.rect,
      center: built.center,
      mesh,
      body,
      tier,
      colliders,
      collidersOn,
    });
  }

  deactivate(gx: number, gz: number): void {
    const k = this.key(gx, gz);
    const state = this.chunks.get(k);
    if (!state) return;
    if (state.xfade) this.disposeCrossFade(state.xfade);
    this.group.remove(state.mesh);
    state.mesh.geometry.dispose();
    this.physics.world.removeRigidBody(state.body);
    this.chunks.delete(k);
  }

  update(cameras: readonly Pt[]): void {
    if (this.disposed || cameras.length === 0) return;
    const dt = this.tickDt();
    // 1+2. Chunk-key selection (deactivate culled, activate desired) via the
    //      shared 071 planner: XZ-only, nearest-first, hysteresis + budget.
    const plan = planStream(this.chunks.keys(), cameras, this.policy);
    for (const c of plan.deactivate) this.deactivate(c.gx, c.gz);
    for (const c of plan.activate) {
      const center = chunkCenter(c.gx, c.gz, this.chunkSize);
      const d = nearestChunkCameraDistance({ x: center.x, y: 0, z: center.z }, cameras);
      this.activate(c.gx, c.gz, chunkLod(d, undefined, this.lod));
    }
    // 3. LOD tier updates key off the 3D camera distance (hysteresis), local to
    //    terrain. Cross-fade the swap when enabled + off the low tier; else snap.
    const xfade = this.crossFadeSeconds > 0 && this.quality !== "low";
    for (const state of this.chunks.values()) {
      const d = nearestChunkCameraDistance(state.center, cameras);
      const newTier = chunkLod(d, state.tier, this.lod);
      if (newTier !== state.tier) {
        if (xfade) this.beginCrossFade(state, newTier);
        else this.rebuild(state, newTier);
      }
    }
    if (this.crossFadeSeconds > 0) this.advanceCrossFades(dt);
  }

  /** Elapsed seconds since the last tick, clamped to [0, 0.1] (hitch guard). */
  private tickDt(): number {
    const t = this.now();
    const dt = t - this.lastNow;
    this.lastNow = t;
    return dt > 0 ? Math.min(dt, 0.1) : 0;
  }

  /**
   * Start a dithered LOD cross-fade: current mesh -> inverse-fade (dissolves
   * OUT), new-tier mesh -> normal-fade (dissolves IN), both at uFade=0. Colliders
   * + state.tier swap now (physics never fades); a mid-fade swap snaps the prior.
   */
  private beginCrossFade(state: ChunkState, newTier: TerrainLodTier): void {
    if (state.xfade) this.completeCrossFade(state);
    const oldMesh = state.mesh;
    const oldMat = this.createFadeMaterial(state, "out");
    oldMesh.material = oldMat;
    const built = this.buildChunkMesh(state.gx, state.gz, newTier);
    const newMat = this.createFadeMaterial(state, "in");
    state.mesh = this.addChunkMesh(built.geometry, newMat);
    state.rect = built.rect;
    // advanceCrossFades runs later this frame (pre-render), writing t to both.
    if (state.collidersOn) this.enableTierCollider(state, newTier);
    state.tier = newTier;
    state.xfade = { oldMesh, oldMat, newMat, t: 0 };
  }

  /** Ramp every in-flight cross-fade toward t=1; complete the ones that reach it. */
  private advanceCrossFades(dt: number): void {
    const step = dt / this.crossFadeSeconds;
    for (const state of this.chunks.values()) {
      if (state.xfade && stepCrossFade(state.xfade, step)) this.completeCrossFade(state);
    }
  }

  /** Finish a cross-fade: drop the old mesh, revert the survivor to solid. */
  private completeCrossFade(state: ChunkState): void {
    const x = state.xfade;
    if (!x) return;
    removeOutgoing(this.group, x);
    state.mesh.material = this.materialFor(state.gx, state.gz);
    x.newMat.dispose();
    state.xfade = undefined;
  }

  /** Tear down a cross-fade whose chunk is being destroyed (both fade mats). */
  private disposeCrossFade(x: CrossFade): void {
    removeOutgoing(this.group, x);
    x.newMat.dispose();
  }

  /** Rebuild the shared near material when runtime quality changes detail. */
  setQuality(tier: QualityTier): void {
    if (this.disposed || tier === this.detailQuality) return;
    const previous = this.materialNear;
    const next = this.createNearMaterial(tier);
    this.materialNear = next;
    this.detailQuality = tier;
    for (const state of this.chunks.values()) {
      if (state.mesh.material === previous) state.mesh.material = next;
    }
    previous.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const state of this.chunks.values()) {
      if (state.xfade) this.disposeCrossFade(state.xfade);
      this.group.remove(state.mesh);
      state.mesh.geometry.dispose();
      this.physics.world.removeRigidBody(state.body);
    }
    this.chunks.clear();
    this.materialNear.dispose();
    this.materialFar.dispose();
    this.heightMap.dispose();
    this.group.clear();
  }

  private key(gx: number, gz: number): string {
    return chunkKey(gx, gz);
  }

  /** True iff chunk (gx,gz) lies fully inside the worldSize (near/cache) square. */
  private isNearChunk(gx: number, gz: number): boolean {
    const b = chunkBounds(gx, gz, this.chunkSize);
    const half = this.worldSize / 2;
    return b.x0 >= -half && b.x1 <= half && b.z0 >= -half && b.z1 <= half;
  }

  private materialFor(gx: number, gz: number): THREE.Material {
    return this.isNearChunk(gx, gz) ? this.materialNear : this.materialFar;
  }

  /** Build a layer-1 receive-shadow chunk mesh (frozen matrix) and parent it. */
  private addChunkMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.layers.set(TERRAIN_LAYER);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  private createNearMaterial(tier: QualityTier): CelMaterial {
    return buildNearCel(this.heightMapField(), tier);
  }

  /**
   * Transient dither-fade material for a cross-fade half, in the chunk's own
   * family. Mode "in"/"out" picks normal vs inverse discard; near mirrors the
   * shared surface detail (quality tier) so the fade is shading-seamless.
   */
  private createFadeMaterial(state: ChunkState, mode: FadeMode): CelMaterial {
    return this.isNearChunk(state.gx, state.gz)
      ? buildNearCel(this.heightMapField(), this.detailQuality, mode)
      : buildFarCel(mode);
  }

  /** {@link HeightMapField} view over the shared height texture + world bounds. */
  heightMapField(): HeightMapField {
    const origin = -this.worldSize / 2;
    return {
      texture: this.heightMap,
      origin: [origin, origin],
      size: this.worldSize,
      texels: this.heightMap.image.height as number,
    };
  }

  private buildSegmentRect(gx: number, gz: number, tier: TerrainLodTier): ChunkRect {
    const b = chunkBounds(gx, gz, this.chunkSize);
    const seg = segmentTier(this.quality, tier);
    return { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, segX: seg, segZ: seg };
  }

  /**
   * Build a chunk's visual mesh geometry (merged base + skirt) for `tier`.
   * The collider is separate (createTierCollider) so a tier change can swap
   * mesh geometry without touching Rapier. Returns the tier rect + chunk
   * center (center is tier-independent: rect x0/z0 don't depend on seg count).
   */
  private buildChunkMesh(
    gx: number,
    gz: number,
    tier: TerrainLodTier,
  ): { rect: ChunkRect; center: Pt; geometry: THREE.BufferGeometry } {
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
    return { rect, center, geometry };
  }

  /**
   * Build a per-tier trimesh collider for the driving surface (base chunk
   * verts only, no skirt) attached to `body`. Created disabled when `enabled`
   * is false so a tier can be cached without being queryable until toggled.
   * Friction + restitution match the original single-collider build.
   */
  private createTierCollider(
    gx: number,
    gz: number,
    tier: TerrainLodTier,
    body: RAPIER.RigidBody,
    enabled: boolean,
  ): RAPIER.Collider {
    const rect = this.buildSegmentRect(gx, gz, tier);
    const chunk = buildChunk(rect, this.src);
    const desc = RAPIER.ColliderDesc.trimesh(chunk.positions, chunk.indices)
      .setFriction(1.0)
      .setRestitution(0)
      .setEnabled(enabled);
    return this.physics.world.createCollider(desc, body);
  }

  private rebuild(state: ChunkState, newTier: TerrainLodTier): void {
    state.mesh.geometry.dispose();
    const built = this.buildChunkMesh(state.gx, state.gz, newTier);
    state.mesh.geometry = built.geometry;
    state.rect = built.rect;
    // Only touch colliders when this chunk currently has an enabled one (202):
    // an out-of-collider-range chunk swaps geometry only, and refreshColliders
    // builds the right tier's collider when a kart re-enters range.
    if (state.collidersOn) this.enableTierCollider(state, newTier);
    state.tier = newTier;
  }

  /**
   * Toggle the cached collider for `tier` on `state` instead of dropping the
   * body and recreating it: a trimesh createCollider rebuilds the BVH, which is
   * the cost we avoid. Lazy-build on first visit to a tier (disabled), then
   * flip setEnabled. Only one collider is ever enabled per chunk, so rays
   * never double-hit. Sets collidersOn.
   */
  private enableTierCollider(state: ChunkState, tier: TerrainLodTier): void {
    const oldCollider = state.collidersOn ? state.colliders.get(state.tier) : undefined;
    let next = state.colliders.get(tier);
    if (!next) {
      next = this.createTierCollider(state.gx, state.gz, tier, state.body, false);
      state.colliders.set(tier, next);
    }
    if (oldCollider && oldCollider !== next) oldCollider.setEnabled(false);
    next.setEnabled(true);
    state.collidersOn = true;
  }

  /** Disable the chunk's enabled collider (keep it cached for a fast return). */
  private disableChunkColliders(state: ChunkState): void {
    const collider = state.colliders.get(state.tier);
    if (collider) collider.setEnabled(false);
    state.collidersOn = false;
  }

  /** XZ distance from `center` to the nearest current collider focus. */
  private colliderFocusDistance(center: Pt): number {
    return nearestFocusDistanceXZ(center.x, center.z, this.colliderFoci);
  }

  /** True iff `center` is within colliderRadius of a collider focus. */
  private withinColliderRange(center: Pt): boolean {
    return this.colliderFocusDistance(center) <= this.colliderRadius;
  }

  /**
   * 202 collider-range pass. Enable each active chunk's trimesh collider while
   * its center is within colliderRadius of a focus (kart/AI), and disable it
   * once past colliderCullRadius (hysteresis so an edge chunk does not flap).
   * Independent of the visual stream/LOD pass in update(), so colliders track
   * the karts while terrain renders around the camera out to the fog horizon.
   * A no-op when both radii are Infinity (default): every active chunk keeps
   * its collider.
   */
  refreshColliders(foci: readonly Pt[]): void {
    if (this.disposed) return;
    this.colliderFoci = foci.length > 0 ? foci : ORIGIN_FOCUS;
    for (const state of this.chunks.values()) {
      const d = this.colliderFocusDistance(state.center);
      if (!state.collidersOn && d <= this.colliderRadius) {
        this.enableTierCollider(state, state.tier);
      } else if (state.collidersOn && d > this.colliderCullRadius) {
        this.disableChunkColliders(state);
      }
    }
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
