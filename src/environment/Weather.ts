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

const WEATHER_VERT = /* glsl */ `
  attribute vec3 velocity;
  uniform float uTime;
  uniform float uHalf;
  uniform float uCeiling;
  uniform float uSize;
  uniform float uSizeRange;
  uniform float uFocusX;
  uniform float uFocusZ;
  uniform float uSoft;
  varying vec3 vViewPos;
  void main() {
    float span = 2.0 * uHalf;
    float px = mod(position.x + velocity.x * uTime - uFocusX + uHalf, span) - uHalf;
    float pz = mod(position.z + velocity.z * uTime - uFocusZ + uHalf, span) - uHalf;
    float fall = uCeiling - position.y + (-velocity.y) * uTime;
    float py = uCeiling - mod(fall, uCeiling);
    // Soft flakes waft: a gentle horizontal sway keyed off position.z (an
    // EXISTING per-particle attribute -> no new RNG draw, so the parity-locked
    // buildField draw order is untouched). Gated by uSoft so hard-square presets
    // (rain) keep straight-line motion; uSoft 0 leaves px exactly as wrapped.
    px += uSoft * 0.6 * sin(uTime * 1.3 + position.z);
    vec4 mvPos = modelViewMatrix * vec4(vec3(px, py, pz), 1.0);
    vViewPos = mvPos.xyz;
    gl_PointSize = clamp(uSize * uSizeRange / max(-mvPos.z, 1.0), 1.0, 32.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const WEATHER_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSoft;
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying vec3 vViewPos;
  void main() {
    vec3 c = uColor;
    #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    c = mix(c, fogColor, fogFactor);
    #endif
    // Soft flakes: fade the square point sprite to a round, fuzzy blob via a
    // radial falloff from the sprite centre (0.5,0.5). uSoft 0 (rain + the hard
    // presets) leaves the alpha exactly uOpacity -> the pre-soft hard square,
    // byte-identical output.
    float a = uOpacity;
    if (uSoft > 0.5) {
      float d = length(gl_PointCoord - vec2(0.5));
      a *= smoothstep(0.5, 0.0, d);
    }
    gl_FragColor = vec4(c, a);
  }
`;

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
 * XZ wrap around a moving focus so particles hold fixed world positions and
 * only recycle when they drift past `focus +/- half`: `world = focus +
 * mod(base + vel*t - focus + half, 2*half) - half`. With `focus` 0 the wrap
 * is the legacy origin-anchored form. Y resets to `ceiling` at the ground:
 * a descend phase `fall = (ceiling - base.y) + (-vel.y) * t`, then
 * `y = ceiling - mod(fall, ceiling)`. The caller guarantees base.y in
 * [0, ceiling] and vel.y < 0.
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
  focusX = 0,
  focusZ = 0,
): ParticleVec3 {
  const span = 2 * half;
  const mod = (v: number, s: number): number => ((v % s) + s) % s;
  const x = focusX + mod(base.x + vel.x * t - focusX + half, span) - half;
  const z = focusZ + mod(base.z + vel.z * t - focusZ + half, span) - half;
  const fall = ceiling - base.y + -vel.y * t;
  const y = ceiling - mod(fall, ceiling);
  return { x, y, z };
}

/**
 * 010 commit 4 + 025 commit 3 + 041: fixed-per-session weather. Owns a single
 * procedural `THREE.Points` field whose particle motion runs entirely on the
 * GPU: base positions + per-particle velocities are uploaded once as geometry
 * attributes, and a raw `THREE.ShaderMaterial` advances them in the vertex
 * shader by a monotonic `uTime` with the same stateless wrap as
 * {@link advancePosition}. This drops the per-frame CPU loop + the 1500*3
 * float position-buffer re-upload. Patches {@link dayCycleState} fog for a
 * mild weather-driven shift. {@link setLevel} fades the live intensity
 * envelope (default level 1 = bit-identical); {@link rebuildField} swaps the
 * preset's field at the current level without a new Weather instance. The
 * seeded weighted pick is deterministic.
 *
 * Eight presets (see {@link WeatherPreset}): clear builds nothing; the rest
 * spawn a Points field whose particle/fog params come from
 * {@link WEATHER_PRESET_CONFIG} and feed the shader uniforms (cfg.color ->
 * uColor, cfg.size -> uSize, cfg.opacity -> uOpacity, ceiling -> uCeiling,
 * cfg.soft -> uSoft: round fuzzy sprite + gentle sway for snow/blizzard/fog).
 * rain + snow keep their EXACT pre-biome velocity init (per-particle RNG draw
 * order included) so initial positions + velocities stay bit-identical; the
 * generic config path serves the five new presets. Motion is preset-agnostic.
 *
 * Particles sit on layer 0 with `depthWrite:false`; `fog:true` on the raw
 * ShaderMaterial makes three.js push scene-fog values into the manually
 * declared fogColor/fogNear/fogFar uniforms each frame, and the fragment
 * shader fades distant particles via `smoothstep(fogNear, fogFar, -vViewPos.z)`
 * (the proven materials/celWater.ts pattern). Layer 0 keeps them visible
 * through the sky-posterize depth mask while skipping the Sobel outline
 * (layer 1) and sky-gradient replace (layer 2) — same reasoning as the
 * DynamicSky moon/stars.
 *
 * `update(dt)` advances the uTime accumulator then patches fog AFTER
 * DynamicSky has written it (Environment.update cascade order is
 * sky-first-then-weather): near/far are pulled by the preset factors, and the
 * color is lerped 25% toward the preset tint. Weather reads the just-written
 * singleton fog values each frame (DynamicSky replaces the `fogColor` ref;
 * `fogNear`/`fogFar` are number reassigns), so it must not cache them across
 * frames.
 *
 * The `clear` preset builds no Points (`group` empty, `intensity` 0) and
 * `update()` is an early-return no-op — the common case stays free.
 */
export class Weather {
  readonly group = new THREE.Group();
  /**
   * Active preset. Mutable so {@link rebuildField} can swap it without a new
   * Weather instance; external callers should treat it as read-only and swap
   * via rebuildField.
   */
  preset: WeatherPreset;
  /** Backing field for the live fade {@link intensity} envelope (0..1). */
  private level: number;
  private points?: THREE.Points;
  private material?: THREE.ShaderMaterial;
  private fogPatch?: { tint: THREE.Color; nearFactor: number; farFactor: number };
  private readonly worldHalf: number;
  private readonly ceiling: number;
  private readonly particleCount: number;
  private readonly windSpeed: number;
  /** Base opacity captured at field build; setLevel scales uOpacity against it. */
  private baseOpacity = 0;
  /** Monotonic elapsed time fed to the vertex shader as uTime. */
  private elapsed = 0;

  /**
   * Live fade level in [0,1]: 0 for clear, 1 for a freshly-built particle
   * field (bit-identical to the pre-envelope behaviour). Reflects
   * {@link setLevel}; rebuildField preserves the current level.
   */
  get intensity(): number {
    return this.level;
  }

  constructor(opts: WeatherOptions = {}) {
    const seed = opts.seed ?? 0;
    const preset =
      opts.preset ?? selectWeatherPreset(opts.weights ?? DEFAULT_WEATHER_WEIGHTS, seed);
    this.preset = preset;
    this.level = preset === "clear" ? 0 : 1;
    this.worldHalf = opts.worldHalfExtent ?? DEFAULT_HALF;
    this.ceiling = opts.ceiling ?? DEFAULT_CEILING;
    this.particleCount = opts.particleCount ?? DEFAULT_PARTICLE_COUNT;
    this.windSpeed = opts.windSpeed ?? DEFAULT_WIND;
    if (preset === "clear") return;

    const field = this.buildField(preset, seed, this.windSpeed);
    this.points = field.points;
    this.material = field.material;
    this.fogPatch = field.fogPatch;
    this.baseOpacity = field.baseOpacity;
  }

  /**
   * Advance the GPU uTime accumulator by dt, follow the focus XZ, and patch
   * the dayCycleState fog. No particle loop, no buffer re-upload (motion runs
   * in the vertex shader by the monotonic uTime). No-op for the clear preset.
   */
  update(dt: number, focusX = 0, focusZ = 0): void {
    const material = this.material;
    if (material === undefined) {
      return; // clear preset: nothing to advance
    }
    this.elapsed += dt;
    material.uniforms.uTime.value = this.elapsed;
    material.uniforms.uFocusX.value = focusX;
    material.uniforms.uFocusZ.value = focusZ;
    this.group.position.x = focusX;
    this.group.position.z = focusZ;
    this.patchFog();
  }

  /**
   * Set the live fade level for the active field in [0,1]. Scales uOpacity
   * against the field's base opacity and, via {@link intensity}, scales the
   * fog patch ({@link patchFog} reads the live level each update). NaN or
   * non-finite `k` clamp to 0. No-op for the clear preset (no material, and
   * the level stays 0). Default level 1 at construction is bit-identical to
   * the pre-envelope behaviour.
   */
  setLevel(k: number): void {
    if (this.material === undefined) return; // clear: no field to fade
    const clamped = Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
    this.level = clamped;
    this.material.uniforms.uOpacity.value = this.baseOpacity * clamped;
  }

  /**
   * Swap the active preset's field without a new Weather instance. Disposes
   * the old Points geometry + material and removes the old Points from the
   * group, then builds a fresh field for `preset` via {@link buildField}
   * (rain/snow particle init stays bit-identical). The new field starts at
   * the current {@link level} so a director can rebuild invisible (0) then
   * fade in via {@link setLevel}; uTime is reset to 0. "clear" tears the
   * field down (group empty) and forces level 0. The active preset is
   * updated and exposed via {@link preset}.
   */
  rebuildField(preset: WeatherPreset, seed: number): void {
    if (this.points !== undefined) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
    }
    this.material?.dispose();
    this.points = undefined;
    this.material = undefined;
    this.fogPatch = undefined;
    this.preset = preset;
    if (preset === "clear") {
      this.level = 0;
      this.baseOpacity = 0;
      return;
    }
    const field = this.buildField(preset, seed, this.windSpeed);
    this.points = field.points;
    this.material = field.material;
    this.fogPatch = field.fogPatch;
    this.baseOpacity = field.baseOpacity;
    this.elapsed = 0;
    this.material.uniforms.uTime.value = 0;
    this.setLevel(this.level);
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
    const k = this.intensity; // live fade level (0..1)
    dayCycleState.fogNear = dayCycleState.fogNear * (1 - fp.nearFactor * k);
    dayCycleState.fogFar = dayCycleState.fogFar * (1 - fp.farFactor * k);
    dayCycleState.fogColor.lerp(fp.tint, FOG_TINT_FACTOR * k);
  }

  /**
   * Build the Points field (geometry with static `position` + `velocity`
   * attributes, uploaded once, + a raw ShaderMaterial) for a non-clear preset
   * from {@link WEATHER_PRESET_CONFIG}. rain + snow keep their EXACT pre-biome
   * velocity init (per-particle RNG draw order included) so initial positions +
   * velocities stay bit-identical — the determinism tests assert those. The
   * generic config path serves the five new presets, which have no parity
   * obligation. See AGENTS.md "Subsystem Invariants".
   */
  private buildField(
    preset: Exclude<WeatherPreset, "clear">,
    seed: number,
    windSpeed: number,
  ): {
    points: THREE.Points;
    material: THREE.ShaderMaterial;
    fogPatch: { tint: THREE.Color; nearFactor: number; farFactor: number };
    ceiling: number;
    baseOpacity: number;
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
    geo.setAttribute("velocity", new THREE.BufferAttribute(velocities, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHalf: { value: this.worldHalf },
        uCeiling: { value: ceiling },
        uSize: { value: cfg.size },
        uSizeRange: { value: 300 },
        uColor: { value: new THREE.Color(cfg.color) },
        uOpacity: { value: cfg.opacity },
        // Soft round + wafting sway for snow/blizzard/fog; 0 keeps hard squares.
        uSoft: { value: cfg.soft ? 1 : 0 },
        uFocusX: { value: 0 },
        uFocusZ: { value: 0 },
        fogColor: { value: new THREE.Color(0xb6ad9e) },
        fogNear: { value: 90 },
        fogFar: { value: 360 },
      },
      vertexShader: WEATHER_VERT,
      fragmentShader: WEATHER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const points = new THREE.Points(geo, material);
    points.layers.set(WEATHER_LAYER);
    // Particles wrap around uFocusX/uFocusZ in the VERTEX shader; the
    // CPU-side geometry bounds stay origin-centred, so once the focus travels
    // the stale sphere would cull the whole field (rain/snow blink out when
    // the camera looks away from spawn). The field always surrounds the
    // camera — skip the cull test (mirrors KartVfxLayer's points).
    points.frustumCulled = false;
    this.group.add(points);
    return {
      points,
      material,
      fogPatch: {
        tint: new THREE.Color(cfg.fogTint),
        nearFactor: cfg.fogNearFactor,
        farFactor: cfg.fogFarFactor,
      },
      ceiling,
      baseOpacity: cfg.opacity,
    };
  }
}
