import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import { PropField, type PropFieldOptions } from "./PropField";
import { Clouds, type CloudsOptions } from "./Clouds";
import { Water, type WaterOptions } from "./Water";
import { DynamicSky, type DynamicSkyOptions } from "./DynamicSky";

export interface EnvironmentOptions {
  propField?: PropFieldOptions;
  clouds?: CloudsOptions;
  water?: WaterOptions;
  dynamicSky?: DynamicSkyOptions;
}

/**
 * 004 environment dressing bundle: PropField (terrain-conforming props +
 * Rapier colliders), Clouds (drifting layer 0 puffs), Water (cel valley plane
 * on layer 1), and DynamicSky (010 day-cycle clock + stars + moon). One group
 * for the scene, one update per frame (sky clock + cloud drift + water uTime),
 * one dispose that tears down all GL resources and removes every Rapier body
 * PropField created.
 */
export class Environment {
  readonly group = new THREE.Group();
  private readonly propField: PropField;
  private readonly clouds: Clouds;
  private readonly water: Water;
  private readonly dynamicSky: DynamicSky;

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: EnvironmentOptions = {}) {
    this.propField = new PropField(physics, terrain, opts.propField);
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(opts.water);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.group.add(this.propField.group, this.clouds.group, this.water.mesh, this.dynamicSky.group);
  }

  /** Per-frame: advance the sky clock, drift clouds by dt, advance water uTime. */
  update(dt: number, time: number): void {
    this.dynamicSky.update(dt);
    this.clouds.update(dt);
    this.water.update(time);
  }

  dispose(): void {
    this.dynamicSky.dispose();
    this.propField.dispose();
    this.clouds.dispose();
    this.water.dispose();
    this.group.clear();
  }
}
