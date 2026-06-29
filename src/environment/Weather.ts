import * as THREE from "three";
import { dayCycleState } from "./dayCycle";
import { hashSeed, makeRNG } from "../core/rng";
import {
  DEFAULT_WEATHER_WEIGHTS,
  WEATHER_PRESET_CONFIG,
  selectWeatherPreset,
  type WeatherPreset,
} from "./weatherPresets";

// Back-comat re-exports: Weather.test.ts + historical callers import these from
// "./Weather". The pure pick + config + types live in ./weatherPresets
// (jsdom-testable, no THREE dependency).
export { DEFAULT_WEATHER_WEIGHTS, WEATHER_PRESET_CONFIG, selectWeatherPreset, type WeatherPreset };

const WEATHER_LAYER = 0; // same as DynamicSky moon/stars + Clouds (see AGENTS.md)
const DEFAULT_PARTICLE_COUNT = 1500; // 010 plan Defaults
const DEFAULT_HALF = 100; // matches Clouds/PropField world box
const DEFAULT_CEILING = 60; // matches Clouds height
const DEFAULT_WIND = 8; // m/s, +X drift
const FOG_TINT_FACTOR = 0.25; // lerp fog color 25% toward the preset tint

export interface WeatherOptions {
  /** Explicit preset; if omitted a seeded weighted pick is used. */
  preset?: WeatherPreset;
  /**
   * Biome weather weight table for the seeded pick (biome `weather` field).
   * Default {@link DEFAULT_WEATHER_WEIGHTS}. Ignored when `preset` is set.
   */
  weights?: Readonly<Record<string, number>>;
  /** Session seed for the pick + particle init (default 0). */
  seed?: number;
  /** Particle count for the active field (default 1500). */
  particleCount?: number;
  /** XZ box half extent the field spans (default 100). */
  worldHalfExtent?: number;
  /** Spawn + wrap altitude (default 60; a preset may override). */
  ceiling?: number;
  /** Wind drift in +X m/s (default 8). */
  windSpeed?: number;
}

export interface ParticleVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Stateless GPU-equivalent particle advance. Returns the wrapped world
 * position of a particle whose base layout is `base` moving at constant
 * per-axis `vel` after elapsed `t` seconds, inside an XZ box of half-extent
 * `half` and a Y range [0, ceiling]. Pure: same inputs -> same output, no
 * GL. The vertex shader in the GPU rewrite mirrors these three
 * expressions verbatim.
 *
 * XZ use continuous mod wrap into [-half, half] (bidirectional). Y resets
 * to `ceiling` at the ground: a descend phase `fall = (ceiling - base.y) +
 * (-vel.y) * t`, then `y = ceiling - mod(fall, ceiling)`. The caller
 * guarantees base.y in [0, ceiling] and vel.y < 0.
 *
 * Continuous-wrap differs from the old CPU teleport (which dropped the
 * overshoot on overflow) by an imperceptible amount for a precipitation
 * field; the difference is documented here and visually verified.
 */
export function advancePosition(
  base: ParticleVec3,
  vel: ParticleVec3,
  t: number,
  half: number,
  ceiling: number,
): ParticleVec3 {
  const span = 2 * half;
  const mod = (v: number, s: number): number => ((v % s) + s) % s;
  const x = mod(base.x + vel.x * t + half, span) - half;
  const z = mod(base.z + vel.z * t + half, span) - half;
  const fall = ceiling - base.y + -vel.y * t;
  const y = ceiling - mod(fall, ceiling);
  return { x, y, z };
}

/**
 * 010 commit 4 + 025 commit 3: fixed-per-session weather. Owns a single
 * procedural `THREE.Points` field with wind drift + wrap, and patches the
 * {@link dayCycleState} fog for a mild weather-driven shift. Fixed preset per
 * session (no runtime toggle); the seeded weighted pick is deterministic.
 *
 * Eight presets (see {@link WeatherPreset}): clear builds nothing; the rest
 * spawn a Points field whose particle/fog params come from
 * {@link WEATHER_PRESET_CONFIG}. rain + snow stay bit-identical to the
 * pre-biome behaviour (see buildField parity note); fog/sandstorm/blizzard/
 * heatHaze/aurora are new, cheap Points fields. A biome supplies a weight
 * table via {@link WeatherOptions.weights}; the default table reproduces the
 * old clear/rain/snow split exactly.
 *
 * Particles sit on layer 0 with `depthWrite:false`; `fog` stays at its default
 * (true) so distant particles fade naturally into scene fog. Layer 0 keeps them
 * visible through the sky-posterize depth mask while skipping the Sobel outline
 * (layer 1) and sky-gradient replace (layer 2) — same reasoning as the
 * DynamicSky moon/stars.
 *
 * `update(dt)` advances positions then patches fog AFTER DynamicSky has written
 * it (Environment.update cascade order is sky-first-then-weather): near/far are
 * pulled by the preset factors, and the color is lerped 25% toward the preset
 * tint. Weather reads the just-written singleton fog values each frame
 * (DynamicSky replaces the `fogColor` ref; `fogNear`/`fogFar` are number
 * reassigns), so it must not cache them across frames.
 *
 * The `clear` preset builds no Points (`group` empty, `intensity` 0) and
 * `update()` is an early-return no-op — the common case stays free.
 */
export class Weather {
  readonly group = new THREE.Group();
  readonly preset: WeatherPreset;
  /** 0 for clear, 1 for any particle field (exposes intensity for tests). */
  readonly intensity: number;
  private readonly points?: THREE.Points;
  private readonly material?: THREE.PointsMaterial;
  private readonly positions?: Float32Array;
  private readonly velocities?: Float32Array;
  private readonly positionAttr?: THREE.BufferAttribute;
  private readonly fogPatch?: { tint: THREE.Color; nearFactor: number; farFactor: number };
  private readonly worldHalf: number;
  private readonly ceiling: number;
  /** Effective spawn + wrap altitude for the active field (preset may override). */
  private readonly fieldCeiling: number;
  private readonly particleCount: number;

  constructor(opts: WeatherOptions = {}) {
    const seed = opts.seed ?? 0;
    const preset =
      opts.preset ?? selectWeatherPreset(opts.weights ?? DEFAULT_WEATHER_WEIGHTS, seed);
    this.preset = preset;
    this.intensity = preset === "clear" ? 0 : 1;
    this.worldHalf = opts.worldHalfExtent ?? DEFAULT_HALF;
    this.ceiling = opts.ceiling ?? DEFAULT_CEILING;
    this.fieldCeiling = this.ceiling;
    this.particleCount = opts.particleCount ?? DEFAULT_PARTICLE_COUNT;
    if (preset === "clear") return;

    const field = this.buildField(preset, seed, opts.windSpeed ?? DEFAULT_WIND);
    this.points = field.points;
    this.material = field.material;
    this.positions = field.positions;
    this.velocities = field.velocities;
    this.positionAttr = field.positionAttr;
    this.fogPatch = field.fogPatch;
    this.fieldCeiling = field.ceiling;
  }

  /**
   * Advance particles by dt (fall + wind drift + wrap) and patch the
   * dayCycleState fog. No-op for the clear preset (intensity 0).
   */
  update(dt: number, focusX = 0, focusZ = 0): void {
    const positions = this.positions;
    const velocities = this.velocities;
    const attr = this.positionAttr;
    if (positions === undefined || velocities === undefined || attr === undefined) {
      return; // clear preset: nothing to advance
    }
    const half = this.worldHalf;
    const ceiling = this.fieldCeiling;
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
    this.group.position.x = focusX;
    this.group.position.z = focusZ;
    this.patchFog();
  }

  /** Free particle geometry + material. Idempotent; no-op for clear. */
  dispose(): void {
    this.points?.geometry.dispose();
    this.material?.dispose();
  }

  /** Patch dayCycleState fog for a mild weather-driven shift (non-clear only). */
  private patchFog(): void {
    const fp = this.fogPatch;
    if (fp === undefined) return; // clear preset never reaches here, but guard
    const k = this.intensity; // 1 for any particle field
    dayCycleState.fogNear = dayCycleState.fogNear * (1 - fp.nearFactor * k);
    dayCycleState.fogFar = dayCycleState.fogFar * (1 - fp.farFactor * k);
    dayCycleState.fogColor.lerp(fp.tint, FOG_TINT_FACTOR * k);
  }

  /**
   * Build the Points field (positions + velocities + material) for a non-clear
   * preset from {@link WEATHER_PRESET_CONFIG}. rain + snow keep their EXACT
   * pre-biome velocity init (per-particle RNG draw order included) so initial
   * positions stay bit-identical — the determinism tests assert those. The
   * generic config path serves the five new presets, which have no parity
   * obligation. See AGENTS.md "Subsystem Invariants".
   */
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
    fogPatch: { tint: THREE.Color; nearFactor: number; farFactor: number };
    ceiling: number;
  } {
    const cfg = WEATHER_PRESET_CONFIG[preset];
    const ceiling = cfg.ceiling ?? this.ceiling;
    // presetHash in the seed so different presets produce different layouts
    // even for the same session seed.
    const rng = makeRNG(hashSeed("weather-particles") ^ seed ^ hashSeed(preset));
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      positions[o] = rng.range(-this.worldHalf, this.worldHalf);
      positions[o + 1] = rng.range(0, ceiling);
      positions[o + 2] = rng.range(-this.worldHalf, this.worldHalf);
      if (preset === "rain") {
        // Parity: old rain set X = const windSpeed (NO rng draw), then Y, Z.
        // Keeping the draw order preserves initial positions bit-for-bit.
        velocities[o] = windSpeed; // +X wind, constant (no jitter)
        velocities[o + 1] = cfg.fall; // fast fall (-25)
        velocities[o + 2] = rng.unit() * cfg.drift; // small Z jitter
      } else if (preset === "snow") {
        // Parity: old snow drew X (wind*0.4 + unit*2), then Y, then Z (unit*2).
        velocities[o] = windSpeed * cfg.windFactor + rng.unit() * cfg.drift;
        velocities[o + 1] = cfg.fall; // slow fall (-2)
        velocities[o + 2] = rng.unit() * cfg.drift; // more drift
      } else {
        // Generic config path for fog/sandstorm/blizzard/heatHaze/aurora.
        velocities[o] = windSpeed * cfg.windFactor + rng.unit() * cfg.drift;
        velocities[o + 1] = cfg.fall;
        velocities[o + 2] = rng.unit() * cfg.drift;
      }
    }
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", positionAttr);
    const material = new THREE.PointsMaterial({
      color: cfg.color,
      size: cfg.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: cfg.opacity,
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
      fogPatch: {
        tint: new THREE.Color(cfg.fogTint),
        nearFactor: cfg.fogNearFactor,
        farFactor: cfg.fogFarFactor,
      },
      ceiling,
    };
  }
}
