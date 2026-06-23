import * as THREE from "three";
import { dayCycleState } from "./dayCycle";
import { hashSeed, makeRNG } from "../core/rng";

const WEATHER_LAYER = 0; // same as DynamicSky moon/stars + Clouds (see AGENTS.md)
const DEFAULT_PARTICLE_COUNT = 1500; // 010 plan Defaults
const DEFAULT_HALF = 100; // matches Clouds/PropField world box
const DEFAULT_CEILING = 60; // matches Clouds height
const DEFAULT_WIND = 8; // m/s, +X drift
const RAIN_FALL = 25; // m/s vertical (fast)
const SNOW_FALL = 2; // m/s vertical (slow)
const FOG_NEAR_FACTOR = 0.2; // pull fog near in 20% at full intensity
const FOG_FAR_FACTOR = 0.15; // pull fog far in 15% at full intensity
const FOG_TINT_FACTOR = 0.25; // lerp fog color 25% toward the preset tint

/** Active weather preset for a session. Clear builds nothing; rain/snow spawn. */
export type WeatherPreset = "clear" | "rain" | "snow";

export interface WeatherOptions {
  /** Explicit preset; if omitted a seeded weighted pick is used. */
  preset?: WeatherPreset;
  /** Session seed for the pick + particle init (default 0). */
  seed?: number;
  /** Particle count for rain/snow (default 1500). */
  particleCount?: number;
  /** XZ box half extent the field spans (default 100). */
  worldHalfExtent?: number;
  /** Spawn + wrap altitude (default 60). */
  ceiling?: number;
  /** Wind drift in +X m/s (default 8). */
  windSpeed?: number;
}

/**
 * Deterministic weighted weather preset pick. Pure: same seed -> same preset.
 * Weights mirror the 010 plan Defaults: clear 70%, rain 15%, snow 15%. A single
 * roll partitions [0,1): `< 0.7 -> clear`, `< 0.85 -> rain`, else snow. Exported
 * separately from {@link Weather} so unit tests can exercise distribution +
 * reachability without constructing a particle field.
 */
export function selectWeatherPreset(seed: number): WeatherPreset {
  const rng = makeRNG(hashSeed("weather") ^ seed);
  const roll = rng.next();
  if (roll < 0.7) return "clear";
  if (roll < 0.85) return "rain";
  return "snow";
}

/**
 * 010 commit 4: fixed-per-session precipitation. Owns a single procedural
 * `THREE.Points` field (rain or snow) with wind drift + wrap, and patches the
 * {@link dayCycleState} fog for a mild weather-driven shift. Fixed preset per
 * session (no runtime toggle); the seeded pick makes it deterministic.
 *
 * Rain: small (size 1.5), fast-falling (vy -25 m/s) blue-gray particles with a
 * constant +X wind. Snow: larger (size 2.5), slow (vy -2 m/s) white particles
 * with wind + extra drift jitter. Both wrap X/Z across the world box and Y from
 * ground back to the ceiling so the field never depletes.
 *
 * Particles sit on layer 0 with `depthWrite:false`; `fog` stays at its default
 * (true) so distant particles fade naturally into scene fog. Layer 0 keeps them
 * visible through the sky-posterize depth mask while skipping the Sobel outline
 * (layer 1) and sky-gradient replace (layer 2) — same reasoning as the
 * DynamicSky moon/stars.
 *
 * `update(dt)` advances positions then patches fog AFTER DynamicSky has written
 * it (Environment.update cascade order is sky-first-then-weather): near pulls
 * in 20%, far 15%, and the color is lerped 25% toward a preset tint. Weather
 * reads the just-written singleton fog values each frame (DynamicSky replaces
 * the `fogColor` ref; `fogNear`/`fogFar` are number reassigns), so it must not
 * cache them across frames.
 *
 * The `clear` preset builds no Points (`group` empty, `intensity` 0) and
 * `update()` is an early-return no-op — the common case stays free.
 */
export class Weather {
  readonly group = new THREE.Group();
  readonly preset: WeatherPreset;
  /** 0 for clear, 1 for rain/snow (exposes the active intensity for tests). */
  readonly intensity: number;
  private readonly points?: THREE.Points;
  private readonly material?: THREE.PointsMaterial;
  private readonly positions?: Float32Array;
  private readonly velocities?: Float32Array;
  private readonly positionAttr?: THREE.BufferAttribute;
  private readonly fogTint?: THREE.Color;
  private readonly worldHalf: number;
  private readonly ceiling: number;
  private readonly particleCount: number;

  constructor(opts: WeatherOptions = {}) {
    const seed = opts.seed ?? 0;
    const preset = opts.preset ?? selectWeatherPreset(seed);
    this.preset = preset;
    this.intensity = preset === "clear" ? 0 : 1;
    this.worldHalf = opts.worldHalfExtent ?? DEFAULT_HALF;
    this.ceiling = opts.ceiling ?? DEFAULT_CEILING;
    this.particleCount = opts.particleCount ?? DEFAULT_PARTICLE_COUNT;
    if (preset === "clear") return;

    const field = this.buildField(preset, seed, opts.windSpeed ?? DEFAULT_WIND);
    this.points = field.points;
    this.material = field.material;
    this.positions = field.positions;
    this.velocities = field.velocities;
    this.positionAttr = field.positionAttr;
    this.fogTint = field.fogTint;
  }

  /**
   * Advance particles by dt (fall + wind drift + wrap) and patch the
   * dayCycleState fog. No-op for the clear preset (intensity 0).
   */
  update(dt: number): void {
    const positions = this.positions;
    const velocities = this.velocities;
    const attr = this.positionAttr;
    if (positions === undefined || velocities === undefined || attr === undefined) {
      return; // clear preset: nothing to advance
    }
    const half = this.worldHalf;
    const ceiling = this.ceiling;
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      positions[o] += velocities[o] * dt;
      positions[o + 1] += velocities[o + 1] * dt;
      positions[o + 2] += velocities[o + 2] * dt;
      if (positions[o + 1] < 0) positions[o + 1] = ceiling; // Y: ground -> ceiling
      if (positions[o] > half) positions[o] = -half;
      else if (positions[o] < -half) positions[o] = half; // X wrap
      if (positions[o + 2] > half) positions[o + 2] = -half;
      else if (positions[o + 2] < -half) positions[o + 2] = half; // Z wrap
    }
    attr.needsUpdate = true;
    this.patchFog();
  }

  /** Free particle geometry + material. Idempotent; no-op for clear. */
  dispose(): void {
    this.points?.geometry.dispose();
    this.material?.dispose();
  }

  /** Patch dayCycleState fog for a mild weather-driven shift (rain/snow only). */
  private patchFog(): void {
    const tint = this.fogTint;
    if (tint === undefined) return; // clear preset never reaches here, but guard
    const k = this.intensity; // 1 for rain/snow
    dayCycleState.fogNear = dayCycleState.fogNear * (1 - FOG_NEAR_FACTOR * k);
    dayCycleState.fogFar = dayCycleState.fogFar * (1 - FOG_FAR_FACTOR * k);
    dayCycleState.fogColor.lerp(tint, FOG_TINT_FACTOR * k);
  }

  /** Build the rain/snow Points field (positions + velocities + material). */
  private buildField(
    preset: Exclude<WeatherPreset, "clear">,
    seed: number,
    windSpeed: number,
  ): {
    points: THREE.Points;
    material: THREE.PointsMaterial;
    positions: Float32Array;
    velocities: Float32Array;
    positionAttr: THREE.BufferAttribute;
    fogTint: THREE.Color;
  } {
    const isRain = preset === "rain";
    // presetHash in the seed so rain vs snow particle layouts differ even for
    // the same session seed.
    const rng = makeRNG(hashSeed("weather-particles") ^ seed ^ hashSeed(preset));
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      positions[o] = rng.range(-this.worldHalf, this.worldHalf);
      positions[o + 1] = rng.range(0, this.ceiling);
      positions[o + 2] = rng.range(-this.worldHalf, this.worldHalf);
      if (isRain) {
        velocities[o] = windSpeed; // +X wind, constant (no jitter)
        velocities[o + 1] = -RAIN_FALL; // fast fall
        velocities[o + 2] = rng.unit(); // small Z jitter
      } else {
        velocities[o] = windSpeed * 0.4 + rng.unit() * 2; // wind + drift
        velocities[o + 1] = -SNOW_FALL; // slow fall
        velocities[o + 2] = rng.unit() * 2; // more drift
      }
    }
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", positionAttr);
    const material = new THREE.PointsMaterial({
      color: isRain ? 0x8090a0 : 0xffffff,
      size: isRain ? 1.5 : 2.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: isRain ? 0.6 : 0.85,
      depthWrite: false,
      // fog: true is the PointsMaterial default — kept so distant particles
      // fade naturally with the scene fog.
    });
    const points = new THREE.Points(geo, material);
    points.layers.set(WEATHER_LAYER);
    this.group.add(points);
    return {
      points,
      material,
      positions,
      velocities,
      positionAttr,
      fogTint: new THREE.Color(isRain ? 0x506070 : 0xa8b0b8),
    };
  }
}
