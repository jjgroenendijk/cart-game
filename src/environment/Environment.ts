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
import { DEFAULT_WEATHER_WEIGHTS, type WeatherPreset } from "./weatherPresets";
import { levelAt, makeSchedule, type WeatherMode, type WeatherSchedule } from "./weatherDirector";
import { channelLevel } from "./weatherChannels";
import {
  makeLightningSchedule,
  activeFlash,
  FLASH_DURATION,
  type LightningSchedule,
} from "./lightning";
import { wetnessUniform } from "../materials/cel";
import { Wildlife, type WildlifeOptions } from "./Wildlife";
import { floraFor } from "./floraRegistry";
import { resolveBiome, type BiomeDefinition, type BiomeId } from "../terrain/biomes";
import { dayCycleState } from "./dayCycle";
import { degToRad } from "../core/math";
import { qualityKnobs, type QualityTier } from "../core/quality";
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
  water: { color?: number; shallow?: number; deep?: number };
  wildlife: { kinds?: readonly string[] };
} {
  const counts: Record<string, number> = {};
  for (const f of biome.flora) counts[f.kind] = f.count;
  return {
    dressing: { counts },
    weather: { weights: biome.weather },
    water: {
      ...(biome.waterColor !== undefined ? { color: biome.waterColor } : {}),
      ...(biome.waterShallow !== undefined ? { shallow: biome.waterShallow } : {}),
      ...(biome.waterDeep !== undefined ? { deep: biome.waterDeep } : {}),
    },
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
  const layers: PropLayer[] = Object.keys(counts).map((kind) => {
    const builder = floraFor(kind);
    return {
      kind,
      count: counts[kind]!,
      minScale: 0.8,
      maxScale: 1.2,
      // Decor tolerates steeper ground than big props.
      maxSlope: builder.big ? maxSlope : maxSlope + degToRad(25),
      // Cluster recipe (e.g. palm groves) is a property of the kind.
      ...(builder.cluster ? { cluster: builder.cluster } : {}),
    };
  });
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
  /**
   * Seeded weather director (054 commit 2): a schedule of fronts the director
   * resolves each frame into {preset, level}. DEFAULT mode is the resolved
   * session preset (one infinite segment at level 1) so behaviour is
   * bit-identical until a mode opts in.
   */
  private readonly weatherSeed: number;
  private readonly weatherWeights: Readonly<Record<string, number>>;
  private weatherElapsed = 0;
  private weatherSchedule: WeatherSchedule;
  private lastWeatherPreset: WeatherPreset;
  /**
   * Seeded lightning flash schedule (054 commit 4). Built lazily when the
   * active preset is storm, cleared on any non-storm front so a handover to
   * calmer weather stops flashing immediately.
   */
  private lightningSchedule: LightningSchedule | null = null;
  private readonly wildlife: Wildlife;
  /**
   * Resolved biome fog/sky/light tint Colors (allocated once in the ctor;
   * undefined for temperate or when the biome omits a field). Lerped per-frame
   * toward the just-written dayCycleState scratch refs after DynamicSky.update
   * (see {@link applyBiomeSkyFogBias}). biomeTintFactor defaults to
   * BIOME_TINT_FACTOR; a biome skyFogBias.factor wins.
   */
  private readonly biomeFogTint?: THREE.Color;
  private readonly biomeSkyTint?: THREE.Color;
  private readonly biomeSunTint?: THREE.Color;
  private readonly biomeAmbientTint?: THREE.Color;
  private readonly biomeZenithTint?: THREE.Color;
  private readonly biomeHorizonTint?: THREE.Color;
  private readonly biomeTintFactor: number = BIOME_TINT_FACTOR;
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
    if (def?.skyFogBias?.sunTint !== undefined) {
      this.biomeSunTint = new THREE.Color(def.skyFogBias.sunTint);
    }
    if (def?.skyFogBias?.ambientTint !== undefined) {
      this.biomeAmbientTint = new THREE.Color(def.skyFogBias.ambientTint);
    }
    if (def?.skyFogBias?.skyZenithTint !== undefined) {
      this.biomeZenithTint = new THREE.Color(def.skyFogBias.skyZenithTint);
    }
    if (def?.skyFogBias?.skyHorizonTint !== undefined) {
      this.biomeHorizonTint = new THREE.Color(def.skyFogBias.skyHorizonTint);
    }
    if (def?.skyFogBias !== undefined) {
      this.biomeTintFactor = def.skyFogBias.factor ?? BIOME_TINT_FACTOR;
    }
    const dressingOpts = { ...derived?.dressing, ...opts.dressing };
    const weatherOpts = { ...derived?.weather, ...opts.weather };
    // Biome water.color merges UNDER explicit opts.water so Game's explicit
    // water.level wins while the biome hue still applies when not overridden.
    const waterOpts = { ...derived?.water, ...opts.water };
    // 062: feed the baked bed-height field + the terrain water level into the
    // depth-aware water shader. Optional on SamplerTerrain; stubs/tests omit
    // both -> water keeps the legacy facing look (no HEIGHT_MAP define).
    const waterHm = terrain.heightMapField?.();
    if (waterHm) waterOpts.heightMap = waterHm;
    if (terrain.waterLevel !== undefined) waterOpts.waterY = terrain.waterLevel;
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
    // Weather director: default schedule = one infinite segment of the resolved
    // session pick -> level 1 (non-clear) / 0 (clear) forever = parity.
    this.weatherSeed = weatherOpts.seed ?? 0;
    this.weatherWeights = weatherOpts.weights ?? DEFAULT_WEATHER_WEIGHTS;
    this.weatherSchedule = makeSchedule(this.weatherSeed, this.weatherWeights, this.weather.preset);
    this.lastWeatherPreset = this.weather.preset;
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
   * (static; pinned to the baked heightmap square so foam covers it all),
   * weather (follow-focus), dressing streaming (single-element focus array
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
    this.water.update(time);
    // Weather director (054 commit 2): resolve {preset, level} from elapsed
    // and drive Weather. Field swaps happen ONLY at zero crossings (level 0),
    // so the default single-segment schedule never swaps and setLevel(1)/
    // setLevel(0) each frame is a no-op-parity write. Placed BEFORE
    // weather.update so patchFog reads the just-set level.
    this.weatherElapsed += dt;
    const wl = levelAt(this.weatherSchedule, this.weatherElapsed);
    if (wl.preset !== this.lastWeatherPreset && wl.level <= 0) {
      this.weather.rebuildField(wl.preset, this.weatherSeed);
      this.lastWeatherPreset = wl.preset;
    }
    this.weather.setLevel(wl.level);
    // Weather channels (054 commit 3): sky-dim, cloud wind, ground wetness,
    // all lerped by the weather envelope. Sits between applyBiomeSkyFogBias
    // (already ran this frame) and weather.update/patchFog (next), so it
    // satisfies the cascade-order invariant. clouds.update already ran this
    // frame, so the wind multiplier takes effect next frame (imperceptible
    // for gradual drift). dimFactor scales the day-cycle intensities (numbers
    // the Renderer reads for light intensity); wetnessUniform fans out by ref
    // to every terrain CelMaterial. Existing presets keep dim=1/wind=1 so sky
    // + clouds stay byte-identical; only rain/snow wet the ground.
    const ch = channelLevel(wl.preset, wl.level);
    dayCycleState.sunIntensity *= ch.dimFactor;
    dayCycleState.ambientIntensity *= ch.dimFactor;
    this.clouds.setWindMultiplier(ch.windFactor);
    wetnessUniform.uWetness.value = ch.wetness;
    // Lightning (054 commit 4): build the storm schedule lazily (seeded by
    // weatherSeed); clear it on any non-storm front so a handover stops
    // flashing. Applied AFTER the dim/wind/wetness writes, BEFORE
    // weather.update/patchFog. DynamicSky overwrites sunIntensity fresh each
    // frame so the additive boost never accumulates across frames.
    if (wl.preset === "storm") {
      if (!this.lightningSchedule) {
        this.lightningSchedule = makeLightningSchedule(this.weatherSeed);
      }
      const f = activeFlash(this.lightningSchedule, this.weatherElapsed);
      if (f) {
        const decay = Math.max(0, 1 - (this.weatherElapsed - f.atSec) / FLASH_DURATION);
        const boost = f.strength * decay * 1.5;
        dayCycleState.sunIntensity += boost;
        dayCycleState.ambientIntensity += boost * 0.6;
      }
    } else {
      this.lightningSchedule = null;
    }
    this.weather.update(dt, focusX, focusZ);
    this.focusPt.x = focusX;
    this.focusPt.z = focusZ;
    this.dressing.update([this.focusPt]);
    this.wildlife.update(dt, time);
  }

  /**
   * Lerp the just-written dayCycleState fog + sky + light colors toward the
   * biome tints by {@link biomeTintFactor}. Identity for temperate (all tints
   * undefined). Separate skyZenithTint/skyHorizonTint win over the shared
   * skyTint when set (tropical); desert/alpine/tundra keep the shared skyTint
   * path (both zenith + horizon). Runs after DynamicSky.update so it shifts the
   * fresh values, and before Weather.update so Weather's tested fog factors
   * stay bit-identical under temperate (no bias to stack on).
   */
  private applyBiomeSkyFogBias(): void {
    if (this.biomeFogTint !== undefined) {
      dayCycleState.fogColor.lerp(this.biomeFogTint, this.biomeTintFactor);
    }
    if (this.biomeZenithTint !== undefined) {
      dayCycleState.skyZenith.lerp(this.biomeZenithTint, this.biomeTintFactor);
    } else if (this.biomeSkyTint !== undefined) {
      dayCycleState.skyZenith.lerp(this.biomeSkyTint, this.biomeTintFactor);
    }
    if (this.biomeHorizonTint !== undefined) {
      dayCycleState.skyHorizon.lerp(this.biomeHorizonTint, this.biomeTintFactor);
    } else if (this.biomeSkyTint !== undefined) {
      dayCycleState.skyHorizon.lerp(this.biomeSkyTint, this.biomeTintFactor);
    }
    if (this.biomeSunTint !== undefined) {
      dayCycleState.sunColor.lerp(this.biomeSunTint, this.biomeTintFactor);
    }
    if (this.biomeAmbientTint !== undefined) {
      dayCycleState.ambientColor.lerp(this.biomeAmbientTint, this.biomeTintFactor);
    }
  }

  /**
   * 042: apply a runtime time-of-day change without rebuilding Environment.
   * Forwards to DynamicSky setters: day-length first (ratio-preserving), then
   * an absolute elapsed snap (so the chosen phase wins), then the freeze gate.
   */
  setTimeOfDay(opts: { dayLengthSeconds: number; startElapsed: number; frozen: boolean }): void {
    this.dynamicSky.setDayLength(opts.dayLengthSeconds);
    this.dynamicSky.setElapsed(opts.startElapsed);
    this.dynamicSky.setFrozen(opts.frozen);
  }

  /**
   * 062: apply a quality tier to the water sun glint. Mirrors
   * FieldBuilder.setQuality: takes the tier, resolves knobs internally, and
   * forwards the glint scalar to Water. dpr is unused for this knob (glint is
   * tier-only 0/1), so 1 is passed.
   */
  setQuality(tier: QualityTier): void {
    this.water.setGlintIntensity(qualityKnobs(tier, 1).waterGlintIntensity);
  }

  /**
   * 054: apply a runtime weather-mode change without rebuilding Environment.
   * Rebuilds the schedule for the chosen mode, resets the elapsed clock to 0,
   * and resolves {preset, level} at t=0 so the preview reflects the chosen
   * weather at once. Unlike the per-frame director, the field swap is NOT
   * gated on a level<=0 crossing: at elapsed 0 a fixed mode is already at full
   * level, so the immediate rebuild is the whole point. setLevel pushes the
   * resolved level onto Weather (a no-op-parity write when unchanged).
   */
  setWeatherMode(mode: WeatherMode): void {
    this.weatherSchedule = makeSchedule(this.weatherSeed, this.weatherWeights, mode);
    this.weatherElapsed = 0;
    const wl = levelAt(this.weatherSchedule, 0);
    if (wl.preset !== this.weather.preset) {
      this.weather.rebuildField(wl.preset, this.weatherSeed);
    }
    this.lastWeatherPreset = wl.preset;
    this.weather.setLevel(wl.level);
  }

  /**
   * Snapshot the weather director state for the audio driver (054 commit 4).
   * `preset` + `level` are the just-resolved front; `elapsed` is the absolute
   * schedule time (drives thunder flash advancement); `seed` rebuilds the
   * lightning schedule if a storm front started.
   */
  get weatherInfo(): {
    preset: WeatherPreset;
    level: number;
    elapsed: number;
    seed: number;
  } {
    return {
      preset: this.weather.preset,
      level: this.weather.intensity,
      elapsed: this.weatherElapsed,
      seed: this.weatherSeed,
    };
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
