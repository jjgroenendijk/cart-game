import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import { PropField, type PropFieldOptions } from "./PropField";
import { Clouds, type CloudsOptions } from "./Clouds";
import { Water, type WaterOptions } from "./Water";
import { DynamicSky, type DynamicSkyOptions } from "./DynamicSky";
import { SunDisc, type SunDiscOptions } from "./SunDisc";
import { Weather, type WeatherOptions } from "./Weather";
import { Wildlife, type WildlifeOptions } from "./Wildlife";
import { resolveBiome, type BiomeDefinition, type BiomeId } from "../terrain/biomes";
import { dayCycleState } from "./dayCycle";

export interface EnvironmentOptions {
  propField?: PropFieldOptions;
  clouds?: CloudsOptions;
  water?: WaterOptions;
  dynamicSky?: DynamicSkyOptions;
  sunDisc?: SunDiscOptions;
  weather?: WeatherOptions;
  wildlife?: WildlifeOptions;
  /**
   * Biome source for derived propField.counts + weather.weights. Explicit
   * caller opts win (merged OVER the biome-derived slice) so Game's explicit
   * water/dynamicSky still apply. Temperate reproduces the pre-biome defaults
   * bit-for-bit (counts == DEFAULT_PROP_COUNTS, weights == DEFAULT_WEATHER_WEIGHTS).
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
 * Maps biome.flora -> propField.counts, biome.weather -> weather.weights,
 * biome.waterColor -> water.color, and biome.wildlife -> wildlife.kinds.
 * Returns ONLY the derived slices. Per-frame sky/fog bias is NOT here (it is
 * applied after DynamicSky writes dayCycleState each frame, like
 * Weather.patchFog). For temperate every derived slice is empty (undefined)
 * so the output matches the pre-biome defaults bit-for-bit.
 */
export function biomeEnvironmentOptions(biome: BiomeDefinition): {
  propField: Pick<PropFieldOptions, "counts">;
  weather: Pick<WeatherOptions, "weights">;
  water: { color?: number };
  wildlife: { kinds?: readonly string[] };
} {
  const counts: Record<string, number> = {};
  for (const f of biome.flora) counts[f.kind] = f.count;
  return {
    propField: { counts },
    weather: { weights: biome.weather },
    water: biome.waterColor !== undefined ? { color: biome.waterColor } : {},
    wildlife: biome.wildlife !== undefined ? { kinds: biome.wildlife } : {},
  };
}

/**
 * 004 environment dressing bundle: PropField (terrain-conforming props +
 * Rapier colliders), Clouds (drifting layer 0 puffs), Water (cel valley plane
 * on layer 1), DynamicSky (010 day-cycle clock + stars + moon), SunDisc (014
 * additive sun-disc overlay tracking sunDirWorld), Weather (010 seeded
 * rain/snow points + fog shift), and Wildlife (017 ambient critter
 * InstancedMesh). One group for the scene, one update per frame (sky clock +
 * sun-disc + cloud drift + water uTime + weather + wildlife), one dispose
 * that tears down all GL resources and removes every Rapier body PropField
 * created.
 */
export class Environment {
  readonly group = new THREE.Group();
  private readonly propField: PropField;
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

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: EnvironmentOptions = {}) {
    // Biome fan-out: resolve the biome once, derive propField.counts +
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
    const propFieldOpts = { ...derived?.propField, ...opts.propField };
    const weatherOpts = { ...derived?.weather, ...opts.weather };
    // Biome water.color merges UNDER explicit opts.water so Game's explicit
    // water.level wins while the biome hue still applies when not overridden.
    const waterOpts = { ...derived?.water, ...opts.water };
    const wildlifeOpts = { ...derived?.wildlife, ...opts.wildlife };
    this.propField = new PropField(physics, terrain, propFieldOpts);
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(waterOpts);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.sunDisc = new SunDisc(opts.sunDisc);
    this.weather = new Weather(weatherOpts);
    this.wildlife = new Wildlife(terrain, wildlifeOpts);
    this.group.add(
      this.propField.group,
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
   * the sun disc, drift clouds by dt, advance water uTime, then weather.
   * CASCADE ORDER MATTERS: DynamicSky writes dayCycleState first; the biome
   * bias lerps those just-written scratch refs; then Weather's own fog patch
   * stacks on top (Weather multiplies the already-biased value). For temperate
   * the bias is a no-op so Weather sees exactly what DynamicSky wrote (parity).
   */
  update(dt: number, time: number): void {
    this.dynamicSky.update(dt);
    this.applyBiomeSkyFogBias();
    this.sunDisc.update();
    this.clouds.update(dt);
    this.water.update(time);
    this.weather.update(dt);
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
    this.propField.dispose();
    this.clouds.dispose();
    this.water.dispose();
    this.wildlife.dispose();
    this.group.clear();
  }
}
