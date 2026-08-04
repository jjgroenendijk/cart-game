import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain, PropLayer } from "./propSampler";
import { sampleChunkProps, type ChunkSampleOptions } from "./propSampler";
import { PropField } from "./PropField";
import type { ImpostorAtlas } from "./ImpostorField";
import { useImpostor } from "../materials/impostor";
import {
  chunkBounds,
  chunkCenter,
  chunkKey,
  desiredChunks,
  nearestFocusDistanceXZ,
} from "../terrain/streamGrid";
import { planStream, type StreamPolicy } from "../terrain/chunkStream";
import { clamp01 } from "../core/rng";
import type { QualityTier } from "../core/quality";
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
  /**
   * 202 collider-range decoupling. A bundle spawns prop Rapier bodies only when
   * its chunk center is within colliderRadius (XZ) of a collider focus (kart/AI
   * position, passed to refreshColliders); bodies are removed once the center
   * passes colliderCullRadius (hysteresis). Visual streaming keeps using
   * streamRadius/cullRadius around the camera focus, so props render out to the
   * fog horizon while colliders stay bounded near the karts. Both default to
   * Infinity -> every visible bundle keeps colliders (pre-202 coupled behavior).
   */
  colliderRadius?: number;
  colliderCullRadius?: number;
  /**
   * 201 distance density falloff. Decor scatter (bush/flower/grass — not big
   * props, not colliders) draws full instance count within densityNearRadius of
   * a camera focus and thins to densityMin at densityFarRadius, quantized into
   * densityBands steps with densityHysteresis metres of margin so a bundle on a
   * band edge does not flap. Defaults derive from streamRadius/cullRadius so the
   * falloff scales with draw distance; densityMin >= 1 (or bands <= 0) disables
   * it (every bundle keeps full decor — pre-201 behavior).
   */
  densityNearRadius?: number;
  densityFarRadius?: number;
  densityMin?: number;
  densityBands?: number;
  densityHysteresis?: number;
  /**
   * 200 runtime-baked foliage impostors. When `impostorAtlas` is supplied (a
   * runtime GPU bake — see ImpostorField.bakeImpostorAtlas), each bundle also
   * builds instanced billboard cards for its big props, and every frame swaps
   * the merged 3D meshes for those cards once the bundle's chunk center passes
   * `impostorStartRadius` (XZ) from a camera focus. `impostorHysteresis` widens
   * the switch band so a bundle on the edge does not flap (default derives from
   * the start radius). Both omitted => no impostors (every bundle keeps full 3D
   * meshes — pre-200 behavior). Impostors carry no colliders.
   */
  impostorAtlas?: ImpostorAtlas;
  impostorStartRadius?: number;
  impostorHysteresis?: number;
  /**
   * Quality tier for tier-gated prop features (315). Drives whether big-prop
   * buckets get a layer-3 emissive snow-sparkle clone: med/high yes, low no
   * (BloomPass is off on low so the clone would be inert). Default "high".
   * setQuality reconciles existing bundles on a mid-session tier change.
   */
  tier?: QualityTier;
}

/** Resolved distance density falloff knobs (201); see DensityBandParams uses. */
export interface DensityBandParams {
  nearRadius: number;
  farRadius: number;
  bands: number;
  minDensity: number;
  hysteresis: number;
}

interface ChunkBundle {
  gx: number;
  gz: number;
  field: PropField;
  /** Dither-fade level driven into the field's big-prop uFade (0..1). */
  fade: number;
  /** Whether this bundle currently has prop Rapier bodies (202 collider range). */
  colliders: boolean;
  /** Current decor density band (201): 0 = full near, `bands` = min far. */
  densityBand: number;
  /** Whether this bundle currently shows far-LOD impostor cards (200). */
  impostor: boolean;
}

/** Default impostor-start hysteresis as a fraction of the start radius (200). */
const DEFAULT_IMPOSTOR_HYSTERESIS_FRAC = 0.12;

/** Origin fallback collider focus until refreshColliders supplies the karts. */
const ORIGIN_FOCUS: readonly Pt[] = [{ x: 0, y: 0, z: 0 }];

const DEFAULT_FADE_SECONDS = 0.45;

/** Distance density falloff defaults (201); see DressingChunkManagerOptions. */
const DEFAULT_DENSITY_NEAR_FRAC = 0.5;
const DEFAULT_DENSITY_BANDS = 5;
const DEFAULT_DENSITY_MIN = 0.35;
const DEFAULT_DENSITY_HYSTERESIS_FRAC = 0.25;

/**
 * Decor draw fraction (0..1) for a density band index (201). Band 0 = full (1),
 * band `bands` = minDensity; linear between. Pure.
 */
export function densityForBand(band: number, p: DensityBandParams): number {
  if (p.bands <= 0) return 1;
  const t = clamp01(band / p.bands);
  return 1 - t * (1 - p.minDensity);
}

/**
 * Resolve the density band for `dist`, biased by the bundle's `current` band so
 * hysteresis keeps a bundle hovering on a boundary from flapping (201). Band 0
 * within nearRadius, band = `bands` at/after farRadius, quantized between. Pure:
 * the band only steps outward once `dist` clears the current band's outer edge
 * plus `hysteresis`, and inward once it drops below the inner edge minus it.
 */
export function densityBandFor(dist: number, current: number, p: DensityBandParams): number {
  if (p.bands <= 0 || p.farRadius <= p.nearRadius) return 0;
  if (dist <= p.nearRadius) return 0;
  if (dist >= p.farRadius) return p.bands;
  const width = (p.farRadius - p.nearRadius) / p.bands;
  let b = current < 0 ? 0 : current > p.bands ? p.bands : current;
  while (b < p.bands && dist > p.nearRadius + (b + 1) * width + p.hysteresis) b++;
  while (b > 0 && dist < p.nearRadius + b * width - p.hysteresis) b--;
  return b;
}

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
  private readonly colliderRadius: number;
  private readonly colliderCullRadius: number;
  private readonly densityParams: DensityBandParams;
  private readonly densityEnabled: boolean;
  private readonly impostorAtlas?: ImpostorAtlas;
  private readonly impostorStartRadius: number;
  private readonly impostorHysteresis: number;
  private readonly impostorEnabled: boolean;
  /** Current quality tier; drives big-prop emissive-clone gating (315). */
  private detailTier: QualityTier;
  /** Latest collider foci (karts/AI); ORIGIN_FOCUS until refreshColliders runs. */
  private colliderFoci: readonly Pt[] = ORIGIN_FOCUS;
  /** Latest visual foci (cameras); ORIGIN_FOCUS until the first update() runs. */
  private visualFoci: readonly Pt[] = ORIGIN_FOCUS;
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
    this.colliderRadius = opts.colliderRadius ?? Infinity;
    this.colliderCullRadius = opts.colliderCullRadius ?? Infinity;
    const nearRadius = opts.densityNearRadius ?? opts.streamRadius * DEFAULT_DENSITY_NEAR_FRAC;
    const farRadius = opts.densityFarRadius ?? opts.cullRadius;
    const bands = opts.densityBands ?? DEFAULT_DENSITY_BANDS;
    const width = bands > 0 && farRadius > nearRadius ? (farRadius - nearRadius) / bands : 0;
    this.densityParams = {
      nearRadius,
      farRadius,
      bands,
      minDensity: opts.densityMin ?? DEFAULT_DENSITY_MIN,
      hysteresis: opts.densityHysteresis ?? width * DEFAULT_DENSITY_HYSTERESIS_FRAC,
    };
    this.densityEnabled = this.densityParams.minDensity < 1 && bands > 0 && farRadius > nearRadius;
    this.impostorAtlas = opts.impostorAtlas;
    this.impostorStartRadius = opts.impostorStartRadius ?? Infinity;
    this.impostorEnabled = !!opts.impostorAtlas && Number.isFinite(this.impostorStartRadius);
    this.impostorHysteresis = this.impostorEnabled
      ? (opts.impostorHysteresis ?? this.impostorStartRadius * DEFAULT_IMPOSTOR_HYSTERESIS_FRAC)
      : 0;
    this.detailTier = opts.tier ?? "high";
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
    const colliders = this.withinColliderRange(gx, gz);
    const field = new PropField(this.physics, this.terrain, {
      placements: placed,
      bigPropBuckets: this.opts.bigPropBuckets ?? 1,
      worldHalfExtent: this.opts.chunkSize / 2,
      colliders,
      impostorAtlas: this.impostorAtlas,
      emissiveClones: this.detailTier !== "low",
    });
    // Dissolved from the first rendered frame; update() ramps it in.
    field.setFade(0);
    // Thin decor to the bundle's distance band from frame 0 so a far-activated
    // bundle renders sparse immediately instead of full-then-thinning (201).
    const densityBand = this.densityEnabled
      ? densityBandFor(this.visualFocusDistance(gx, gz), 0, this.densityParams)
      : 0;
    if (this.densityEnabled) field.setDensity(densityForBand(densityBand, this.densityParams));
    // Swap to far-LOD impostor cards from frame 0 if this bundle activates
    // already past the impostor-start radius (no full-mesh-then-swap pop).
    const impostor =
      this.impostorEnabled &&
      useImpostor(
        this.visualFocusDistance(gx, gz),
        this.impostorStartRadius,
        this.impostorHysteresis,
      );
    if (impostor) field.setImpostor(true);
    this.group.add(field.group);
    this.bundles.set(key, { gx, gz, field, fade: 0, colliders, densityBand, impostor });
  }

  /** XZ distance from chunk (gx,gz) center to the nearest current collider focus. */
  private colliderFocusDistance(gx: number, gz: number): number {
    const c = chunkCenter(gx, gz, this.opts.chunkSize);
    return nearestFocusDistanceXZ(c.x, c.z, this.colliderFoci);
  }

  /** XZ distance from chunk (gx,gz) center to the nearest current camera focus. */
  private visualFocusDistance(gx: number, gz: number): number {
    const c = chunkCenter(gx, gz, this.opts.chunkSize);
    return nearestFocusDistanceXZ(c.x, c.z, this.visualFoci);
  }

  /** True iff chunk (gx,gz) is within colliderRadius of a collider focus. */
  private withinColliderRange(gx: number, gz: number): boolean {
    return this.colliderFocusDistance(gx, gz) <= this.colliderRadius;
  }

  /**
   * 202 collider-range pass. Enable prop bodies on active bundles whose center
   * is within colliderRadius of a focus (kart/AI), and remove them once past
   * colliderCullRadius (hysteresis so a bundle on the edge does not flap).
   * Independent of the visual stream/cull pass in update(), so colliders track
   * the karts while visuals track the camera out to the fog horizon. A no-op
   * when both radii are Infinity (default): every visible bundle keeps bodies.
   */
  refreshColliders(foci: readonly Pt[]): void {
    if (this.disposed) return;
    this.colliderFoci = foci.length > 0 ? foci : ORIGIN_FOCUS;
    for (const b of this.bundles.values()) {
      const d = this.colliderFocusDistance(b.gx, b.gz);
      if (!b.colliders && d <= this.colliderRadius) {
        b.field.setColliders(true);
        b.colliders = true;
      } else if (b.colliders && d > this.colliderCullRadius) {
        b.field.setColliders(false);
        b.colliders = false;
      }
    }
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
    this.visualFoci = cameras;
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
      // Re-band decor density from the bundle's distance to the nearest camera
      // (hysteresis via the stored band keeps it from flapping on an edge).
      if (this.densityEnabled) {
        const band = densityBandFor(
          this.visualFocusDistance(b.gx, b.gz),
          b.densityBand,
          this.densityParams,
        );
        if (band !== b.densityBand) {
          b.densityBand = band;
          b.field.setDensity(densityForBand(band, this.densityParams));
        }
      }
      // Mesh<->impostor swap (200): past impostorStartRadius the bundle's big
      // props render as billboard cards; hysteresis (via the stored state) keeps
      // a bundle on the edge from flapping. Independent of the stream fade above.
      if (this.impostorEnabled) {
        const want = useImpostor(
          this.visualFocusDistance(b.gx, b.gz),
          this.impostorStartRadius,
          this.impostorHysteresis,
          b.impostor,
        );
        if (want !== b.impostor) {
          b.impostor = want;
          b.field.setImpostor(want);
        }
      }
      if (target === 0 && fade === 0) this.deactivate(b.gx, b.gz);
    }
    for (const c of plan.activate) this.activate(c.gx, c.gz);
  }

  /**
   * 315: apply a quality tier. Reconciles big-prop emissive clones on existing
   * bundles (med/high on, low off) and stores the tier so newly-streamed
   * bundles build correctly. Idempotent on an unchanged tier.
   */
  setQuality(tier: QualityTier): void {
    if (tier === this.detailTier) return;
    this.detailTier = tier;
    const on = tier !== "low";
    for (const b of this.bundles.values()) b.field.setEmissiveClones(on);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.bundles.values()) b.field.dispose();
    this.bundles.clear();
    this.group.clear();
  }
}
