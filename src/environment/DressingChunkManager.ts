import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain, PropLayer } from "./propSampler";
import { sampleChunkProps, type ChunkSampleOptions } from "./propSampler";
import { PropField } from "./PropField";
import { chunkBounds, chunkCenter, chunkKey, desiredChunks } from "../terrain/streamGrid";
import { nearestChunkCameraDistance } from "../terrain/terrainLod";
import type { Pt } from "../kart/kartLod";

export interface DressingChunkManagerOptions {
  chunkSize: number;
  streamRadius: number;
  cullRadius: number;
  maxActivations: number;
  baseSeed: number;
  layers: PropLayer[];
  sampler: ChunkSampleOptions;
  /** Big-prop merge buckets per chunk (default 1 = one merged mesh per type). */
  bigPropBuckets?: number;
}

interface ChunkBundle {
  gx: number;
  gz: number;
  field: PropField;
}

/**
 * 023 streaming dressing. Mirrors the terrain chunk grid 1:1: each active
 * chunk gets its own PropField pre-sampled via sampleChunkProps (coordinate-
 * stable seed, so re-activating a chunk reproduces identical placement).
 * update(cameras) runs the streaming driver: deactivate culled chunks (center
 * beyond cullRadius of every camera), activate desired chunks (within
 * streamRadius of at least one camera), throttled to maxActivations per frame
 * so a sudden focus jump does not spike frame time. dispose cascades to every
 * PropField bundle (frees merged geo + Rapier bodies + decor InstancedMesh).
 */
export class DressingChunkManager {
  readonly group = new THREE.Group();

  private readonly physics: PhysicsWorld;
  private readonly terrain: SamplerTerrain;
  private readonly opts: DressingChunkManagerOptions;
  private disposed = false;
  private readonly bundles = new Map<string, ChunkBundle>();

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: DressingChunkManagerOptions) {
    this.physics = physics;
    this.terrain = terrain;
    this.opts = opts;
    const seed = desiredChunks([{ x: 0, y: 0, z: 0 }], opts.streamRadius, opts.chunkSize);
    for (const k of seed) {
      const [gx, gz] = k.split(",").map(Number);
      this.activate(gx, gz);
    }
  }

  get activeCount(): number {
    return this.bundles.size;
  }

  activate(gx: number, gz: number): void {
    if (this.disposed) return;
    const key = chunkKey(gx, gz);
    if (this.bundles.has(key)) return;
    const rect = chunkBounds(gx, gz, this.opts.chunkSize);
    const placed = sampleChunkProps(
      gx,
      gz,
      rect,
      this.terrain,
      this.opts.baseSeed,
      this.opts.layers,
      this.opts.sampler,
    );
    const field = new PropField(this.physics, this.terrain, {
      placements: placed,
      bigPropBuckets: this.opts.bigPropBuckets ?? 1,
      worldHalfExtent: this.opts.chunkSize / 2,
    });
    this.group.add(field.group);
    this.bundles.set(key, { gx, gz, field });
  }

  deactivate(gx: number, gz: number): void {
    const key = chunkKey(gx, gz);
    const b = this.bundles.get(key);
    if (!b) return;
    this.group.remove(b.field.group);
    b.field.dispose();
    this.bundles.delete(key);
  }

  update(cameras: readonly Pt[]): void {
    if (this.disposed || cameras.length === 0) return;
    for (const b of [...this.bundles.values()]) {
      const c = chunkCenter(b.gx, b.gz, this.opts.chunkSize);
      const center: Pt = { x: c.x, y: 0, z: c.z };
      if (nearestChunkCameraDistance(center, cameras) > this.opts.cullRadius) {
        this.deactivate(b.gx, b.gz);
      }
    }
    const desired = desiredChunks(cameras, this.opts.streamRadius, this.opts.chunkSize);
    let activated = 0;
    for (const k of desired) {
      if (activated >= this.opts.maxActivations) break;
      if (this.bundles.has(k)) continue;
      const [gx, gz] = k.split(",").map(Number);
      this.activate(gx, gz);
      activated++;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.bundles.values()) b.field.dispose();
    this.bundles.clear();
    this.group.clear();
  }
}
