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
 * Pure biome -> Environment option fan-out (jsdom-testable, no Rapier/three).
 * Maps biome.flora (FloraEntry[]) -> propField.counts and biome.weather ->
 * weather.weights. Returns ONLY the derived slices (water/sky/wildlife are
 * commit 6). For temperate the output matches the pre-biome defaults exactly.
 */
export function biomeEnvironmentOptions(biome: BiomeDefinition): {
  propField: Pick<PropFieldOptions, "counts">;
  weather: Pick<WeatherOptions, "weights">;
} {
  const counts: Record<string, number> = {};
  for (const f of biome.flora) counts[f.kind] = f.count;
  return { propField: { counts }, weather: { weights: biome.weather } };
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

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: EnvironmentOptions = {}) {
    // Biome fan-out: resolve the biome, derive propField.counts + weather.weights,
    // then merge caller opts OVER the derived slice (explicit wins). No biome ->
    // derived is empty -> behaviour identical to pre-biome (parity).
    const derived =
      opts.biome !== undefined
        ? biomeEnvironmentOptions(
            typeof opts.biome === "string" ? resolveBiome(opts.biome) : opts.biome,
          )
        : null;
    const propFieldOpts = { ...derived?.propField, ...opts.propField };
    const weatherOpts = { ...derived?.weather, ...opts.weather };
    this.propField = new PropField(physics, terrain, propFieldOpts);
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(opts.water);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.sunDisc = new SunDisc(opts.sunDisc);
    this.weather = new Weather(weatherOpts);
    this.wildlife = new Wildlife(terrain, opts.wildlife);
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
   * Per-frame: advance the sky clock, sync the sun disc, drift clouds by dt,
   * advance water uTime, then weather. CASCADE ORDER MATTERS: DynamicSky must
   * run BEFORE SunDisc + Weather so they read the just-written dayCycleState
   * sunDirWorld/nightFactor/fog values (Renderer reads them in the subsequent
   * render).
   */
  update(dt: number, time: number): void {
    this.dynamicSky.update(dt);
    this.sunDisc.update();
    this.clouds.update(dt);
    this.water.update(time);
    this.weather.update(dt);
    this.wildlife.update(dt, time);
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
