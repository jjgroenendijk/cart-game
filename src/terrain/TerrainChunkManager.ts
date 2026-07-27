import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { CelMaterial, HeightMapField } from "../materials/cel";
import { buildFarCel, buildNearCel, type FadeMode } from "./terrainCelMaterials";
import {
  attachMorphTarget,
  defaultNow,
  removeOutgoing,
  stepCrossFade,
  type CrossFade,
} from "./chunkCrossFade";
import type { ChunkRect } from "./chunkBuilder";
import {
  buildChunkMeshGeometry,
  createTierCollider as buildTierCollider,
  type ChunkMeshBuild,
} from "./chunkGeometry";
import { colliderFocusDistance, planColliderRefresh } from "./chunkColliderRange";
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
import { chunkBounds, chunkCenter, chunkKey, desiredChunks } from "./streamGrid";
import { planStream, type StreamPolicy } from "./chunkStream";
import { ChunkSeeder } from "./chunkSeed";
import { buildHeightTexture } from "./chunkHeightTexture";

const TERRAIN_LAYER = 1;

/** Origin fallback collider focus until refreshColliders supplies the karts. */
const ORIGIN_FOCUS: readonly Pt[] = [{ x: 0, y: 0, z: 0 }];

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
   * 206 incremental ctor seed. Caps both the synchronous ctor seed and the
   * per-frame drain (ChunkSeeder): finite -> the ctor seeds only the nearest
   * `seedBudget` chunks and update() drains the rest nearest-camera-first over
   * frames (removes the large-world load hitch; fog hazes the fill-in). Default
   * Infinity -> full synchronous seed (pre-206; tests keep a seeded world).
   */
  seedBudget?: number;
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

/**
 * 023 streaming terrain chunk manager over a SIGNED origin-centered grid
 * (streamGrid helpers): chunk (gx,gz) is signed (negatives allowed) and
 * centered at world (gx*chunkSize, gz*chunkSize). The ctor seeds the chunks
 * within streamRadius of the origin; a finite seedBudget (206) spreads that seed
 * over frames (ChunkSeeder: nearest-origin now, rest drained nearest-camera-first
 * by update()) so the largest worlds do not hitch, and primeSeed force-seeds the
 * spawn region synchronously. update(cameras) then streams:
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
  /** 206: deferred origin-seed queue + per-frame drain budget (nearest-first). */
  private readonly seeder: ChunkSeeder;
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
    this.seeder = new ChunkSeeder(this.chunkSize, opts.seedBudget ?? Infinity);
    // 206: seed only the nearest seedBudget chunks now; update() drains the rest.
    const desired = desiredChunks([{ x: 0, y: 0, z: 0 }], this.policy.streamRadius, this.chunkSize);
    for (const c of this.seeder.seedInitial(desired)) {
      this.activate(c.gx, c.gz, chunkLod(c.d, undefined, this.lod));
    }
    // The chunk group is parented once and never transformed again ->
    // freeze its matrix so the renderer skips its per-frame compose.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  get activeCount(): number {
    return this.chunks.size;
  }

  /** 206: origin-desired chunks still awaiting an incremental seed. */
  get pendingCount(): number {
    return this.seeder.pendingCount;
  }

  /**
   * 206 per-frame seed drain. Activate up to `seedBudget` still-pending chunks
   * nearest the cameras (ChunkSeeder orders them, dropping already-active keys),
   * so the visible region fills first. LOD tier keys off the 3D camera distance,
   * matching a streamed activation.
   */
  private drainSeed(cameras: readonly Pt[]): void {
    for (const c of this.seeder.drain(cameras, (k) => this.chunks.has(k))) {
      const d3 = nearestChunkCameraDistance({ x: c.x, y: 0, z: c.z }, cameras);
      this.activate(c.gx, c.gz, chunkLod(d3, undefined, this.lod));
    }
  }

  /**
   * 206 spawn prime. Synchronously seed every still-pending chunk within
   * `radius` (XZ) of any focus (kart/AI position). Game calls this at buildField
   * over the collider ring so the gameplay-critical chunks near the spawn/start
   * line — and, via the following collider pass, their colliders — exist before
   * the first physics step, while the far visual-only chunks keep streaming in
   * over frames. A no-op once the queue is drained (default Infinity seed).
   */
  primeSeed(foci: readonly Pt[], radius: number): void {
    if (this.disposed) return;
    for (const c of this.seeder.prime(foci, radius, (k) => this.chunks.has(k))) {
      this.activate(c.gx, c.gz, chunkLod(c.d, undefined, this.lod));
    }
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
    // 0. 206: drain the incremental ctor seed nearest-camera-first (bounded per
    //    frame) before streaming, so the visible region fills in first.
    this.drainSeed(cameras);
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
   * Start a dithered LOD cross-fade + geomorph: old mesh inverse-fades OUT and
   * morphs toward the new tier; new mesh normal-fades IN and morphs FROM the old
   * tier (aMorphTarget + uMorph via stepCrossFade) so the swap has no vertex
   * pop. Colliders + state.tier swap now (physics never fades or morphs).
   */
  private beginCrossFade(state: ChunkState, newTier: TerrainLodTier): void {
    if (state.xfade) this.completeCrossFade(state);
    const oldMesh = state.mesh;
    const oldMat = this.createFadeMaterial(state, "out");
    oldMesh.material = oldMat;
    attachMorphTarget(oldMesh.geometry, state.rect, segmentTier(this.quality, newTier), this.src);
    const built = this.buildChunkMesh(state.gx, state.gz, newTier);
    attachMorphTarget(built.geometry, built.rect, segmentTier(this.quality, state.tier), this.src);
    const newMat = this.createFadeMaterial(state, "in");
    state.mesh = this.addChunkMesh(built.geometry, newMat);
    state.rect = built.rect;
    // advanceCrossFades runs later this frame (pre-render), writing uFade+uMorph.
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
   * Transient dither-fade + geomorph material for a cross-fade half, in the
   * chunk's own family. Mode "in"/"out" picks normal vs inverse discard; near
   * mirrors the shared surface detail (quality tier) so the fade is seamless.
   */
  private createFadeMaterial(state: ChunkState, mode: FadeMode): CelMaterial {
    return this.isNearChunk(state.gx, state.gz)
      ? buildNearCel(this.heightMapField(), this.detailQuality, mode, true)
      : buildFarCel(mode, true);
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

  private buildChunkMesh(gx: number, gz: number, tier: TerrainLodTier): ChunkMeshBuild {
    return buildChunkMeshGeometry(
      gx,
      gz,
      tier,
      this.src,
      this.chunkSize,
      this.quality,
      this.skirtDrop,
    );
  }

  private createTierCollider(
    gx: number,
    gz: number,
    tier: TerrainLodTier,
    body: RAPIER.RigidBody,
    enabled: boolean,
  ): RAPIER.Collider {
    return buildTierCollider(
      gx,
      gz,
      tier,
      body,
      enabled,
      this.src,
      this.chunkSize,
      this.quality,
      this.physics,
    );
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

  /** True iff `center` is within colliderRadius of a collider focus. */
  private withinColliderRange(center: Pt): boolean {
    return colliderFocusDistance(center, this.colliderFoci) <= this.colliderRadius;
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
    const plan = planColliderRefresh(
      this.chunks.values(),
      this.colliderFoci,
      this.colliderRadius,
      this.colliderCullRadius,
    );
    for (const s of plan.enable) this.enableTierCollider(s, s.tier);
    for (const s of plan.disable) this.disableChunkColliders(s);
  }
}
