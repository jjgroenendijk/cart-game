import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain, PropLayer } from "./propSampler";
import { sampleChunkProps, type ChunkSampleOptions } from "./propSampler";
import { PropField } from "./PropField";
import { chunkBounds, chunkKey, desiredChunks } from "../terrain/streamGrid";
import { planStream, type StreamPolicy } from "../terrain/chunkStream";
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
  /** Seconds for a bundle's dither fade in/out (0 = instant pop). Default 0.45. */
  fadeSeconds?: number;
}

interface ChunkBundle {
  gx: number;
  gz: number;
  field: PropField;
  /** Dither-fade level driven into the field's big-prop uFade (0..1). */
  fade: number;
}

const DEFAULT_FADE_SECONDS = 0.45;

/**
 * Advance a fade level toward `target` (0 or 1) by `step`, clamping at the
 * target. Pure; the per-frame step is dt/fadeSeconds so a fade spans
 * fadeSeconds of game time regardless of frame rate.
 */
export function stepFade(fade: number, target: number, step: number): number {
  if (target > fade) return Math.min(target, fade + step);
  if (target < fade) return Math.max(target, fade - step);
  return fade;
}

/**
 * 023 streaming dressing. Mirrors the terrain chunk grid 1:1: each active
 * chunk gets its own PropField pre-sampled via sampleChunkProps (coordinate-
 * stable seed, so re-activating a chunk reproduces identical placement).
 * update(cameras, dt) delegates chunk-key selection to the shared 071
 * planStream planner: deactivate culled bundles (center past cullRadius of
 * every camera), activate desired-not-active bundles (within streamRadius of
 * any camera) nearest-first, capped at maxActivations per frame so a focus
 * jump does not spike frame time. dispose cascades to every PropField bundle
 * (frees merged geo + Rapier bodies + decor InstancedMesh).
 *
 * Dither fade (175): streamed bundles dissolve instead of popping. New
 * bundles activate at fade 0 and ramp to 1 over fadeSeconds (PropField.setFade
 * drives the big-prop uFade); culled bundles ramp to 0 first and are only
 * deactivated once fully dissolved. A fading-out bundle keeps its key active,
 * so the planner never double-activates, and a camera returning inside
 * cullRadius mid-fade simply reverses the ramp. The ctor seed ring snaps to
 * fade 1 (the initial world build shows fully dressed, no dissolve-in).
 */
export class DressingChunkManager {
  readonly group = new THREE.Group();

  private readonly physics: PhysicsWorld;
  private readonly terrain: SamplerTerrain;
  private readonly opts: DressingChunkManagerOptions;
  private readonly policy: StreamPolicy;
  private disposed = false;
  private readonly bundles = new Map<string, ChunkBundle>();

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: DressingChunkManagerOptions) {
    this.physics = physics;
    this.terrain = terrain;
    this.opts = opts;
    this.policy = {
      chunkSize: opts.chunkSize,
      streamRadius: opts.streamRadius,
      cullRadius: opts.cullRadius,
      maxActivations: opts.maxActivations,
    };
    const seed = desiredChunks([{ x: 0, y: 0, z: 0 }], opts.streamRadius, opts.chunkSize);
    for (const k of seed) {
      const [gx, gz] = k.split(",").map(Number);
      this.activate(gx, gz);
    }
    // Seed ring snaps solid: the initial build presents the fully dressed
    // world at once; only bundles streamed in later dissolve in.
    for (const b of this.bundles.values()) {
      b.fade = 1;
      b.field.setFade(1);
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
    // Dissolved from the first rendered frame; update() ramps it in.
    field.setFade(0);
    this.group.add(field.group);
    this.bundles.set(key, { gx, gz, field, fade: 0 });
  }

  deactivate(gx: number, gz: number): void {
    const key = chunkKey(gx, gz);
    const b = this.bundles.get(key);
    if (!b) return;
    this.group.remove(b.field.group);
    b.field.dispose();
    this.bundles.delete(key);
  }

  update(cameras: readonly Pt[], dt: number): void {
    if (this.disposed || cameras.length === 0) return;
    const plan = planStream(this.bundles.keys(), cameras, this.policy);
    // Culled bundles fade OUT before disposal (target 0, deactivate at 0);
    // everything else ramps toward solid. The planner re-lists a culled key
    // every update while it stays past cullRadius, so a key it stops listing
    // (camera came back) reverses mid-fade. Deleting the current entry while
    // iterating a Map is safe.
    const out = new Set<string>();
    for (const c of plan.deactivate) out.add(chunkKey(c.gx, c.gz));
    const fadeSeconds = this.opts.fadeSeconds ?? DEFAULT_FADE_SECONDS;
    const step = fadeSeconds > 0 ? dt / fadeSeconds : 1;
    for (const [key, b] of this.bundles) {
      const target = out.has(key) ? 0 : 1;
      const fade = stepFade(b.fade, target, step);
      if (fade !== b.fade) {
        b.fade = fade;
        b.field.setFade(fade);
      }
      if (target === 0 && fade === 0) this.deactivate(b.gx, b.gz);
    }
    for (const c of plan.activate) this.activate(c.gx, c.gz);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.bundles.values()) b.field.dispose();
    this.bundles.clear();
    this.group.clear();
  }
}
