import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import { PropField, type PropFieldOptions } from "./PropField";
import { Clouds, type CloudsOptions } from "./Clouds";
import { Water, type WaterOptions } from "./Water";

export interface EnvironmentOptions {
  propField?: PropFieldOptions;
  clouds?: CloudsOptions;
  water?: WaterOptions;
}

/**
 * 004 environment dressing bundle: PropField (terrain-conforming props +
 * Rapier colliders), Clouds (drifting layer 0 puffs), and Water (cel valley
 * plane on layer 1). One group for the scene, one update per frame (cloud
 * drift + water uTime), one dispose that tears down all GL resources and
 * removes every Rapier body PropField created.
 */
export class Environment {
  readonly group = new THREE.Group();
  private readonly propField: PropField;
  private readonly clouds: Clouds;
  private readonly water: Water;

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: EnvironmentOptions = {}) {
    this.propField = new PropField(physics, terrain, opts.propField);
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(opts.water);
    this.group.add(this.propField.group, this.clouds.group, this.water.mesh);
  }

  /** Per-frame: drift clouds by dt, advance the water wave phase by time. */
  update(dt: number, time: number): void {
    this.clouds.update(dt);
    this.water.update(time);
  }

  dispose(): void {
    this.propField.dispose();
    this.clouds.dispose();
    this.water.dispose();
    this.group.clear();
  }
}
