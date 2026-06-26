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

export interface EnvironmentOptions {
  propField?: PropFieldOptions;
  clouds?: CloudsOptions;
  water?: WaterOptions;
  dynamicSky?: DynamicSkyOptions;
  sunDisc?: SunDiscOptions;
  weather?: WeatherOptions;
  wildlife?: WildlifeOptions;
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
    this.propField = new PropField(physics, terrain, opts.propField);
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(opts.water);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.sunDisc = new SunDisc(opts.sunDisc);
    this.weather = new Weather(opts.weather);
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
