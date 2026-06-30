import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import { DressingChunkManager, type DressingChunkManagerOptions } from "./DressingChunkManager";
import { type FloraKind, type PropLayer } from "./propSampler";
import { Clouds, type CloudsOptions } from "./Clouds";
import { Water, type WaterOptions } from "./Water";
import { DynamicSky, type DynamicSkyOptions } from "./DynamicSky";
import { SunDisc, type SunDiscOptions } from "./SunDisc";
import { Weather, type WeatherOptions } from "./Weather";
import { Wildlife, type WildlifeOptions } from "./Wildlife";
import { floraFor } from "./floraRegistry";
import { resolveBiome, type BiomeDefinition, type BiomeId } from "../terrain/biomes";
import { dayCycleState } from "./dayCycle";
import { degToRad } from "../core/math";
import type { Pt } from "../kart/kartLod";

export interface EnvironmentOptions {
  dressing?: DressingOptions;
  clouds?: CloudsOptions;
  water?: WaterOptions;
  dynamicSky?: DynamicSkyOptions;
  sunDisc?: SunDiscOptions;
  weather?: WeatherOptions;
  wildlife?: WildlifeOptions;
  /**
   * Biome source for derived dressing.counts + weather.weights. Explicit
   * caller opts win (merged OVER the biome-derived slice) so Game's explicit
   * water/dynamicSky still apply. Temperate reproduces the pre-biome defaults
   * bit-for-bit (counts == DEFAULT_DRESSING_COUNTS, weights ==
   * DEFAULT_WEATHER_WEIGHTS).
   */
  biome?: BiomeId | BiomeDefinition;
}

/**
 * Per-frame lerp factor for the biome fog/sky tint bias (applied AFTER
 * DynamicSky writes dayCycleState, BEFORE Weather patches). Mirrors Weather's
 * own FOG_TINT_FACTOR approach; 0.2 keeps the shift subtle so Weather's clear
 * cascade stays the dominant mood driver.
 */
const BIOME_TINT_FACTOR = 0.2;

/**
 * Pure biome -> Environment option fan-out (jsdom-testable, no Rapier/three).
 * Maps biome.flora -> dressing.counts, biome.weather -> weather.weights,
 * biome.waterColor -> water.color, and biome.wildlife -> wildlife.kinds.
 * Returns ONLY the derived slices. Per-frame sky/fog bias is NOT here (it is
 * applied after DynamicSky writes dayCycleState each frame, like
 * Weather.patchFog). For temperate every derived slice is empty (undefined)
 * so the output matches the pre-biome defaults bit-for-bit.
 */
export function biomeEnvironmentOptions(biome: BiomeDefinition): {
  dressing: Pick<DressingOptions, "counts">;
  weather: Pick<WeatherOptions, "weights">;
  water: { color?: number };
  wildlife: { kinds?: readonly string[] };
} {
  const counts: Record<string, number> = {};
  for (const f of biome.flora) counts[f.kind] = f.count;
  return {
    dressing: { counts },
    weather: { weights: biome.weather },
    water: biome.waterColor !== undefined ? { color: biome.waterColor } : {},
    wildlife: biome.wildlife !== undefined ? { kinds: biome.wildlife } : {},
  };
}

export interface DressingOptions {
  chunkSize?: number;
  streamRadius?: number;
  cullRadius?: number;
  maxActivations?: number;
  baseSeed?: number;
  bigPropBuckets?: number;
  counts?: Partial<Record<FloraKind, number>>;
  cell?: number;
}

const DEFAULT_DRESSING_COUNTS: Record<FloraKind, number> = {
  tree: 2,
  rock: 1,
  bush: 3,
  flower: 23,
  grass: 47,
};

/**
 * Build the DressingChunkManager config. Kind-agnostic: derives the layer list
 * from the counts table's keys (mirrors PropField.buildSamplerOptions). A
 * supplied counts table FULLY REPLACES the temperate defaults so a
 * non-temperate biome dresses ONLY its own kinds (no temperate bleed); no
 * counts at all falls back to DEFAULT_DRESSING_COUNTS (temperate parity).
 */
function buildDressingConfig(opts?: DressingOptions): DressingChunkManagerOptions {
  const counts = opts?.counts ?? DEFAULT_DRESSING_COUNTS;
  const maxSlope = degToRad(35);
  // Object.keys preserves insertion order for string keys, so the kind order
  // is the counts insertion order (temperate: tree,rock,bush,flower,grass ->
  // bit-identical layer order; a biome's flora order is preserved too).
  const layers: PropLayer[] = Object.keys(counts).map((kind) => ({
    kind,
    count: counts[kind]!,
    minScale: 0.8,
    maxScale: 1.2,
    maxSlope: floraFor(kind).big ? maxSlope : maxSlope + degToRad(25),
  }));
  return {
    chunkSize: opts?.chunkSize ?? 25,
    streamRadius: opts?.streamRadius ?? 140,
    cullRadius: opts?.cullRadius ?? 170,
    maxActivations: opts?.maxActivations ?? 4,
    baseSeed: opts?.baseSeed ?? 1337,
    bigPropBuckets: opts?.bigPropBuckets ?? 1,
    layers,
    sampler: {
      cell: opts?.cell ?? 6,
      maxAttemptsPerCell: 4,
      trackHalfWidth: 6,
      corridorMargin: 3,
      spawnExclusionRadius: 12,
      maxSlope,
    },
  };
}

/**
 * 004 environment dressing bundle: DressingChunkManager (streaming per-chunk
 * terrain-conforming props + Rapier colliders), Clouds (drifting layer 0
 * puffs, follow-focus), Water (cel valley plane on layer 1, follow-focus),
 * DynamicSky (010 day-cycle clock + stars + moon), SunDisc (014 additive
 * sun-disc overlay tracking sunDirWorld), Weather (010 seeded rain/snow
 * points + fog shift, follow-focus), and Wildlife (017 ambient critter
 * InstancedMesh). One group for the scene, one update per frame (sky clock +
 * sun-disc + cloud drift + water uTime + weather + dressing streaming +
 * wildlife) driven by a single focus point (humansMidpoint), one dispose
 * that tears down all GL resources and removes every Rapier body the dressing
 * created.
 */
export class Environment {
  readonly group = new THREE.Group();
  private readonly dressing: DressingChunkManager;
  private readonly clouds: Clouds;
  private readonly water: Water;
  private readonly dynamicSky: DynamicSky;
  private readonly sunDisc: SunDisc;
  private readonly weather: Weather;
  private readonly wildlife: Wildlife;
  /**
   * Resolved biome fog/sky tint Colors (allocated once in the ctor; undefined
   * for temperate). Lerped per-frame toward the just-written dayCycleState
   * scratch refs after DynamicSky.update (see {@link applyBiomeSkyFogBias}).
   */
  private readonly biomeFogTint?: THREE.Color;
  private readonly biomeSkyTint?: THREE.Color;
  private readonly focusPt: Pt = { x: 0, y: 0, z: 0 };

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: EnvironmentOptions = {}) {
    // Biome fan-out: resolve the biome once, derive dressing.counts +
    // weather.weights + water.color + wildlife.kinds, then merge caller opts
    // OVER the derived slice (explicit wins). No biome -> derived is empty ->
    // behaviour identical to pre-biome (parity).
    const def =
      opts.biome !== undefined
        ? typeof opts.biome === "string"
          ? resolveBiome(opts.biome)
          : opts.biome
        : undefined;
    const derived = def ? biomeEnvironmentOptions(def) : null;
    // Per-frame sky/fog bias: pre-resolve the tint Colors once (not per frame).
    // dayCycleState.fogColor/skyZenith/skyHorizon are stable scratch refs
    // DynamicSky reassigns each frame, so an in-place lerp is safe.
    if (def?.skyFogBias?.fogTint !== undefined) {
      this.biomeFogTint = new THREE.Color(def.skyFogBias.fogTint);
    }
    if (def?.skyFogBias?.skyTint !== undefined) {
      this.biomeSkyTint = new THREE.Color(def.skyFogBias.skyTint);
    }
    const dressingOpts = { ...derived?.dressing, ...opts.dressing };
    const weatherOpts = { ...derived?.weather, ...opts.weather };
    // Biome water.color merges UNDER explicit opts.water so Game's explicit
    // water.level wins while the biome hue still applies when not overridden.
    const waterOpts = { ...derived?.water, ...opts.water };
    const wildlifeOpts = { ...derived?.wildlife, ...opts.wildlife };
    this.dressing = new DressingChunkManager(physics, terrain, buildDressingConfig(dressingOpts));
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(waterOpts);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.sunDisc = new SunDisc(opts.sunDisc);
    this.weather = new Weather(weatherOpts);
    this.wildlife = new Wildlife(terrain, wildlifeOpts);
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(waterOpts);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.sunDisc = new SunDisc(opts.sunDisc);
    this.weather = new Weather(weatherOpts);
    this.wildlife = new Wildlife(terrain, wildlifeOpts);
    this.group.add(
      this.dressing.group,
      this.clouds.group,
      this.water.mesh,
      this.dynamicSky.group,
      this.sunDisc.group,
      this.weather.group,
      this.wildlife.group,
    );
  }

  /**
   * Per-frame: advance the sky clock, apply the biome sky/fog tint bias, sync
   * the sun disc, drift clouds by dt (follow-focus), advance water uTime
   * (follow-focus), weather (follow-focus), dressing streaming (single-element
   * focus array reusing a scratch Pt), then wildlife. CASCADE ORDER MATTERS:
   * DynamicSky writes dayCycleState first; the biome bias lerps those
   * just-written scratch refs; then Weather's own fog patch stacks on top.
   * focusX/focusZ default to 0 (spawn-area focus) so menu/attract mode still
   * drives streaming around the spawn.
   */
  update(dt: number, time: number, focusX = 0, focusZ = 0): void {
    this.dynamicSky.update(dt);
    this.applyBiomeSkyFogBias();
    this.sunDisc.update();
    this.clouds.update(dt, focusX, focusZ);
    this.water.update(time, focusX, focusZ);
    this.weather.update(dt, focusX, focusZ);
    this.focusPt.x = focusX;
    this.focusPt.z = focusZ;
    this.dressing.update([this.focusPt]);
    this.wildlife.update(dt, time);
  }

  /**
   * Lerp the just-written dayCycleState fog + sky colors toward the biome
   * tint by {@link BIOME_TINT_FACTOR}. No-op for temperate (tints undefined).
   * Runs after DynamicSky.update so it shifts the fresh values, and before
   * Weather.update so Weather's tested fog factors stay bit-identical under
   * temperate (no bias to stack on).
   */
  private applyBiomeSkyFogBias(): void {
    if (this.biomeFogTint !== undefined) {
      dayCycleState.fogColor.lerp(this.biomeFogTint, BIOME_TINT_FACTOR);
    }
    if (this.biomeSkyTint !== undefined) {
      dayCycleState.skyZenith.lerp(this.biomeSkyTint, BIOME_TINT_FACTOR);
      dayCycleState.skyHorizon.lerp(this.biomeSkyTint, BIOME_TINT_FACTOR);
    }
  }

  dispose(): void {
    this.weather.dispose();
    this.sunDisc.dispose();
    this.dynamicSky.dispose();
    this.dressing.dispose();
    this.clouds.dispose();
    this.water.dispose();
    this.wildlife.dispose();
    this.group.clear();
  }
}
