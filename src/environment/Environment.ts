import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import { DressingChunkManager, type DressingChunkManagerOptions } from "./DressingChunkManager";
import { type FloraKind, type PropLayer } from "./propSampler";
import { Clouds, type CloudsOptions } from "./Clouds";
import { WaterChunkManager, type WaterChunkManagerOptions } from "./WaterChunkManager";
import { DynamicSky, type DynamicSkyOptions } from "./DynamicSky";
import { SunDisc, type SunDiscOptions } from "./SunDisc";
import { Weather, type WeatherOptions } from "./Weather";
import { Waterfall, type WaterfallOptions } from "./Waterfall";
import { DEFAULT_WEATHER_WEIGHTS, type WeatherPreset } from "./weatherPresets";
import { levelAt, makeSchedule, type WeatherMode, type WeatherSchedule } from "./weatherDirector";
import { channelLevel } from "./weatherChannels";
import { easeToward } from "./snowAccum";
import {
  makeLightningSchedule,
  activeFlash,
  FLASH_DURATION,
  type LightningSchedule,
} from "./lightning";
import { snowUniform, wetnessUniform } from "../materials/cel";
import { Wildlife, type WildlifeOptions } from "./Wildlife";
import { floraFor } from "./floraRegistry";
import { resolveBiome, type BiomeDefinition, type BiomeId } from "./biomes/registry";
import { dayCycleState } from "./dayCycle";
import { degToRad } from "../core/math";
import { hashSeed } from "../core/rng";
import { qualityKnobs, type QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";

export interface EnvironmentOptions {
  dressing?: DressingOptions;
  clouds?: CloudsOptions;
  water?: WaterChunkManagerOptions;
  dynamicSky?: DynamicSkyOptions;
  sunDisc?: SunDiscOptions;
  weather?: WeatherOptions;
  wildlife?: WildlifeOptions;
  /**
   * Options for the autumn-forest waterfall landmark. Only consulted when the
   * resolved biome id is `autumn`; other biomes never build the waterfall
   * (undefined subsystem -> no scene-graph or update-path change -> parity).
   */
  waterfall?: WaterfallOptions;
  /**
   * Biome source for derived dressing.counts + weather.weights. Explicit
   * caller opts win (merged OVER the biome-derived slice) so Game's explicit
   * water/dynamicSky still apply. Temperate reproduces the pre-biome defaults
   * bit-for-bit (counts == DEFAULT_DRESSING_COUNTS, weights ==
   * DEFAULT_WEATHER_WEIGHTS).
   */
  biome?: BiomeId | BiomeDefinition;
  /**
   * Half-width of the bounded world (Game passes circuit.worldSize / 2). Grows
   * the cloud domain so puffs fill the sky out to the fog horizon and recycle
   * far beyond view (no near pop-in); Clouds scales its count with the area.
   * Omit (tests) to keep the compact default cloud field (parity).
   */
  worldHalfExtent?: number;
  /**
   * World seed (078): when set, fans out to deterministic per-subsystem seeds
   * (dressing.baseSeed, clouds.seed, weather.seed, wildlife.seed) via the
   * codebase `hashSeed(label) ^ seed` convention so the whole world varies by
   * seed, not just the track. Explicit caller slice seeds still win. Omit to
   * keep each subsystem's fixed default (parity with pre-078 behaviour).
   */
  seed?: number;
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

/**
 * Pure world-seed -> per-subsystem seed fan-out (078). Each label mixes via
 * `hashSeed(label) ^ seed` so dressing/clouds/wildlife/weather vary
 * independently yet deterministically from one root seed (mirrors
 * `selectBiome`'s `hashSeed("biome") ^ seed`). Exported for jsdom unit tests
 * (no DOM, no three.js). Terrain relief has its own label ("terrain") applied
 * in `Game.buildWorld`.
 */
export function worldSubSeeds(seed: number): {
  dressing: number;
  clouds: number;
  weather: number;
  wildlife: number;
} {
  const s = seed >>> 0;
  return {
    dressing: (hashSeed("dressing") ^ s) >>> 0,
    clouds: (hashSeed("clouds") ^ s) >>> 0,
    weather: (hashSeed("weather") ^ s) >>> 0,
    wildlife: (hashSeed("wildlife") ^ s) >>> 0,
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
  /** Prop colliders build only within this distance of a kart focus (202). */
  colliderRadius?: number;
  /** Prop colliders removed beyond this distance (hysteresis). Default Infinity. */
  colliderCullRadius?: number;
}

const DEFAULT_DRESSING_COUNTS: Record<FloraKind, number> = {
  tree: 2,
  birch: 2,
  forestPine: 1,
  rock: 1,
  bush: 3,
  tallGrass: 10,
  flower: 20,
  grass: 40,
};

/**
 * Build the DressingChunkManager config. Kind-agnostic: derives the layer list
 * from the counts table's keys (mirrors PropField.buildSamplerOptions). A
 * supplied counts table FULLY REPLACES the temperate defaults so a
 * non-temperate biome dresses ONLY its own kinds (no temperate bleed); no
 * counts at all falls back to DEFAULT_DRESSING_COUNTS (temperate parity).
 */
/**
 * Minimum cloud domain half-width. Matches the day fog-far horizon (~360) so
 * the cloud field always spans the full visible sky even on small worlds; the
 * recycle boundary then sits in (or past) the horizon haze, never in clear view.
 */
const CLOUD_HORIZON_HALF = 340;

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
    colliderRadius: opts?.colliderRadius,
    colliderCullRadius: opts?.colliderCullRadius,
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
 * puffs, follow-focus), WaterChunkManager (071 streamed cel water tiles on
 * layer 1, streamed around the focus),
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
  private readonly water: WaterChunkManager;
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
  /**
   * CPU-held eased snow-cover level (0..1): the single source of truth written
   * to the shared snowUniform.uSnowCover each frame. easeToward eases it toward
   * the weather channel's instantaneous snowCover target so cover builds/melts
   * gradually (asymmetric) instead of snapping. Terrain + props + tracks all
   * read the one shared uniform this drives.
   */
  private snowCoverEased = 0;
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
   * Autumn-forest waterfall landmark. Built ONLY when the resolved biome id is
   * `autumn`; undefined for every other biome so the scene graph + update path
   * stay bit-identical (parity). All uses are null-guarded.
   */
  private readonly waterfall?: Waterfall;
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
    let cloudsOpts = opts.clouds;
    // World-seed fan-out (078): derive a per-subsystem seed from opts.seed
    // unless the caller already set one (explicit wins). One root seed then
    // varies dressing/clouds/wildlife/weather deterministically.
    if (opts.seed !== undefined) {
      const sub = worldSubSeeds(opts.seed);
      if (dressingOpts.baseSeed === undefined) dressingOpts.baseSeed = sub.dressing;
      if (cloudsOpts?.seed === undefined) cloudsOpts = { ...cloudsOpts, seed: sub.clouds };
      if (weatherOpts.seed === undefined) weatherOpts.seed = sub.weather;
      if (wildlifeOpts.seed === undefined) wildlifeOpts.seed = sub.wildlife;
    }
    // Grow the cloud domain to fill the sky out to the fog horizon (or the
    // world, whichever is larger) so distant clouds are always present and
    // recycle far beyond view instead of popping in at a near boundary. Only
    // when the world extent is known and the caller has not pinned a domain.
    if (opts.worldHalfExtent !== undefined && cloudsOpts?.worldHalfExtent === undefined) {
      const domain = Math.max(opts.worldHalfExtent, CLOUD_HORIZON_HALF);
      cloudsOpts = { ...cloudsOpts, worldHalfExtent: domain };
    }
    this.dressing = new DressingChunkManager(physics, terrain, buildDressingConfig(dressingOpts));
    this.clouds = new Clouds(cloudsOpts);
    this.water = new WaterChunkManager(waterOpts);
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
      this.water.group,
      this.dynamicSky.group,
      this.sunDisc.group,
      this.weather.group,
      this.wildlife.group,
    );
    // Waterfall landmark: autumn-forest ONLY. A non-autumn biome (or none)
    // leaves this.waterfall undefined so the scene graph + update path are
    // unchanged (parity). Added LAST so the existing children indices tests
    // depend on (0..6) stay stable.
    if (def?.id === "autumn") {
      this.waterfall = new Waterfall(opts.waterfall);
      this.group.add(this.waterfall.group);
    }
  }

  /**
   * Per-frame: advance the sky clock, apply the biome sky/fog tint bias, sync
   * the sun disc, drift clouds by dt (follow-focus), weather (follow-focus),
   * then dressing + water streaming (single-element focus array reusing a
   * scratch Pt; water also advances its uTime), then wildlife. CASCADE ORDER
   * MATTERS:
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
    // Weather director (054 commit 2): resolve {preset, level} from elapsed
    // and drive Weather. Field swaps happen on ANY preset change (a fixed
    // sim step rarely samples the exact level-0 boundary, so gating on
    // level<=0 could skip a transition and leave the old field rendering
    // under the new preset's channels). Swaps are rare (once per front), so
    // this rebuilds only on the actual transition frame. Placed BEFORE
    // weather.update so patchFog reads the just-set level.
    this.weatherElapsed += dt;
    const wl = levelAt(this.weatherSchedule, this.weatherElapsed);
    if (wl.preset !== this.lastWeatherPreset) {
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
    // Snow accumulation (shared uSnowCover): fans out by ref to every terrain
    // chunk + prop that opted into snowCover. The channel emits an instantaneous
    // target; easeToward eases the CPU accumulator toward it (build faster than
    // melt) so cover settles + thaws gradually instead of snapping in one frame.
    this.snowCoverEased = easeToward(this.snowCoverEased, ch.snowCover, dt);
    snowUniform.uSnowCover.value = this.snowCoverEased;
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
    this.dressing.update([this.focusPt], dt);
    this.water.update([this.focusPt], time);
    this.wildlife.update(dt, time);
    // Waterfall landmark (autumn-forest only): advances its own animated uTime.
    // World-fixed, so the focus args are passed for contract symmetry but the
    // landmark never follows the camera. No-op when undefined (other biomes).
    this.waterfall?.update(dt, focusX, focusZ);
  }

  /**
   * 202 collider-range pass over the kart/AI foci. Prop Rapier bodies exist
   * only near the karts; the visual dressing stream (update) follows the camera
   * focus out to the fog horizon. Called per-frame by Game with all kart
   * positions.
   */
  updateColliders(foci: readonly Pt[]): void {
    this.dressing.refreshColliders(foci);
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
   * forwards the glint scalar to the water tiles' shared material. dpr is
   * unused for this knob (glint is
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
    this.waterfall?.dispose();
    this.group.clear();
  }
}
