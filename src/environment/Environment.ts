import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import { DressingChunkManager, type DressingChunkManagerOptions } from "./DressingChunkManager";
import { type PropType, type PropLayer } from "./propSampler";
import { Clouds, type CloudsOptions } from "./Clouds";
import { Water, type WaterOptions } from "./Water";
import { DynamicSky, type DynamicSkyOptions } from "./DynamicSky";
import { SunDisc, type SunDiscOptions } from "./SunDisc";
import { Weather, type WeatherOptions } from "./Weather";
import { Wildlife, type WildlifeOptions } from "./Wildlife";
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
}

export interface DressingOptions {
  chunkSize?: number;
  streamRadius?: number;
  cullRadius?: number;
  maxActivations?: number;
  baseSeed?: number;
  bigPropBuckets?: number;
  counts?: Partial<Record<PropType, number>>;
  cell?: number;
}

const DEFAULT_DRESSING_COUNTS: Record<PropType, number> = {
  tree: 2,
  rock: 1,
  bush: 3,
  flower: 23,
  grass: 47,
};

const BIG_DRESSING_TYPES: ReadonlySet<PropType> = new Set(["tree", "rock"]);

function buildDressingConfig(opts?: DressingOptions): DressingChunkManagerOptions {
  const counts = { ...DEFAULT_DRESSING_COUNTS, ...opts?.counts };
  const maxSlope = degToRad(35);
  const layers: PropLayer[] = (["tree", "rock", "bush", "flower", "grass"] as const).map(
    (type) => ({
      type,
      count: counts[type],
      minScale: 0.8,
      maxScale: 1.2,
      maxSlope: BIG_DRESSING_TYPES.has(type) ? maxSlope : maxSlope + degToRad(25),
    }),
  );
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
  private readonly focusPt: Pt = { x: 0, y: 0, z: 0 };

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: EnvironmentOptions = {}) {
    this.dressing = new DressingChunkManager(physics, terrain, buildDressingConfig(opts.dressing));
    this.clouds = new Clouds(opts.clouds);
    this.water = new Water(opts.water);
    this.dynamicSky = new DynamicSky(opts.dynamicSky);
    this.sunDisc = new SunDisc(opts.sunDisc);
    this.weather = new Weather(opts.weather);
    this.wildlife = new Wildlife(terrain, opts.wildlife);
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
   * Per-frame: advance the sky clock, sync the sun disc, drift clouds by dt
   * (follow-focus), advance water uTime (follow-focus), weather (follow-
   * focus), dressing streaming (single-element focus array reusing a scratch
   * Pt), then wildlife. CASCADE ORDER MATTERS: DynamicSky must run BEFORE
   * SunDisc + Weather so they read the just-written dayCycleState
   * sunDirWorld/nightFactor/fog values (Renderer reads them in the subsequent
   * render). focusX/focusZ default to 0 (spawn-area focus) so menu/attract
   * mode still drives streaming around the spawn.
   */
  update(dt: number, time: number, focusX = 0, focusZ = 0): void {
    this.dynamicSky.update(dt);
    this.sunDisc.update();
    this.clouds.update(dt, focusX, focusZ);
    this.water.update(time, focusX, focusZ);
    this.weather.update(dt, focusX, focusZ);
    this.focusPt.x = focusX;
    this.focusPt.z = focusZ;
    this.dressing.update([this.focusPt]);
    this.wildlife.update(dt, time);
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
