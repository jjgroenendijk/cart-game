import * as THREE from "three";
import { degToRad } from "../core/math";
import { clamp01, smoothstep } from "../core/rng";

/**
 * 010 Dynamic sky: pure time-of-day driver.
 *
 * Computes a full day-cycle state (sun arc, phase, color + intensity + fog +
 * exposure curves) from an elapsed time. Mirrors the lightUniforms precedent (pure
 * compute + a shared mutable singleton a later Renderer/DynamicSky commit
 * reads). No WebGL: only THREE.Vector3 / THREE.Color, which run under jsdom.
 *
 * Sun arc is a clean sine over a normalized cycle. cycleT=0 is dawn rising
 * (elevation 0, azimuth 90 = east); cycleT=0.25 is noon (peak elevation,
 * azimuth 180 = south); cycleT=0.5 is dusk setting (elevation 0, azimuth 270
 * = west); cycleT=0.75 is deep night (peak negative elevation).
 */

const TAU = Math.PI * 2;

/** Full day length in seconds at default speed (010 plan Defaults). */
const DEFAULT_DAY_LENGTH = 120;

/**
 * Recommended session start as a cycle fraction. cycleT≈0.12 lands on a lit
 * mid-morning sun (~42 deg at maxElev 62): short, well-defined shadows and no
 * grazing-light terminator banding, so a race starts lit instead of at dawn.
 */
export const DAYTIME_START_FRACTION = 0.12;

/** dayStartSeconds for a given cycle length from {@link DAYTIME_START_FRACTION}. */
export function daytimeStartSeconds(dayLengthSeconds = DEFAULT_DAY_LENGTH): number {
  return DAYTIME_START_FRACTION * dayLengthSeconds;
}

/** Peak sun elevation in degrees (sine amplitude of the arc). */
const MAX_ELEV = 62;

/** Elevation in deg at/below which the sky reads as twilight (dawn/dusk). */
const DAWN_DEG = 8;

/** Elevation in deg below which the sun is under the horizon (night begins). */
const NIGHT_ELEV = 0;

/** Elevation in deg below which cast shadows are fully off (fade 0). */
const SHADOW_FADE_LOW = 3;

/** Elevation in deg above which cast shadows are fully on (fade 1). */
const SHADOW_FADE_HIGH = 18;

/**
 * A single time-of-day keyframe. All keyframe tables are collapsed into one
 * array (sorted ascending by `t`); segments blend between adjacent entries,
 * with a wrap segment from the last entry back to the first across
 * cycleT=1.0==0.0. Field semantics mirror {@link DayCycleState} (which is
 * fully documented): colors are sRGB hex -> LINEAR THREE.Color via default
 * ColorManagement. sun/ambient tints feed lighting; sky/fog tints feed the
 * Renderer sky-posterize slots + scene fog.
 */
interface DayKeyframe {
  /** cycleT position of this keyframe in [0, 1). */
  t: number;
  sunTint: THREE.Color;
  ambientTint: THREE.Color;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  fogTint: THREE.Color;
  /** Cool sky tint unlit/ambient regions lean toward (sRGB hex -> LINEAR). */
  shadeTint: THREE.Color;
  sunIntensity: number;
  ambientIntensity: number;
  fogNear: number;
  fogFar: number;
  /** Tone-mapping exposure scalar (Renderer writes toneMappingExposure). */
  exposure: number;
  /** Warm-sun/cool-shade separation strength 0..~0.25 (noon 0, golden ~0.25). */
  tempContrast: number;
}

/**
 * Eight day-cycle keyframes, ascending by `t`. dawn(0)/noon(0.25)/night(0.75)
 * are exact anchors (match the prior 4-keyframe values for regressions); the
 * rest interpolate distinct golden/blue phases. night-end(0.90) wraps back to
 * dawn(0.0) across cycleT=1.0. The {@link SkyPhase} labels stay a 4-value
 * union (dawn/day/dusk/night); keyframes are data, phases are labels.
 */
const KEYFRAMES: readonly DayKeyframe[] = [
  {
    // dawn: cycleT 0.0. EXACT anchor (regression-stable).
    t: 0.0,
    sunTint: new THREE.Color(0xffd9a0),
    ambientTint: new THREE.Color(0x4a4a6a),
    skyZenith: new THREE.Color(0x6a6a9a),
    skyHorizon: new THREE.Color(0xd0c0a8), // matches FOG_TINTS dawn
    fogTint: new THREE.Color(0xd0c0a8),
    shadeTint: new THREE.Color(0x4a5a72),
    sunIntensity: 1.2,
    ambientIntensity: 0.6,
    fogNear: 90,
    fogFar: 360,
    exposure: 1.0,
    tempContrast: 0.15,
  },
  {
    // golden morning: cycleT 0.10. Warm raking low rising sun.
    t: 0.1,
    sunTint: new THREE.Color(0xffd0a0),
    ambientTint: new THREE.Color(0x5a5a72),
    skyZenith: new THREE.Color(0x5a7fb0),
    skyHorizon: new THREE.Color(0xc8c0a8),
    fogTint: new THREE.Color(0xc8c0a8),
    shadeTint: new THREE.Color(0x4a5e7a),
    sunIntensity: 1.5,
    ambientIntensity: 0.8,
    fogNear: 90,
    fogFar: 360,
    exposure: 1.05,
    tempContrast: 0.25,
  },
  {
    // noon: cycleT 0.25. EXACT anchor (regression-stable, matches Renderer).
    t: 0.25,
    sunTint: new THREE.Color(0xffe8b0), // matches Renderer DirectionalLight
    ambientTint: new THREE.Color(0x8090a0), // matches Renderer HemisphereLight
    skyZenith: new THREE.Color(0x4a8fcf), // matches skyPosterize default
    skyHorizon: new THREE.Color(0xb6ad9e), // matches FOG_TINTS day
    fogTint: new THREE.Color(0xb6ad9e), // matches Renderer scene.fog
    shadeTint: new THREE.Color(0x809098), // near-neutral
    sunIntensity: 2.0,
    ambientIntensity: 1.0,
    fogNear: 90,
    fogFar: 360,
    exposure: 1.0,
    tempContrast: 0.0,
  },
  {
    // afternoon: cycleT 0.40. Warm high sun declining.
    t: 0.4,
    sunTint: new THREE.Color(0xffe0a8),
    ambientTint: new THREE.Color(0x7888a0),
    skyZenith: new THREE.Color(0x4a85c5),
    skyHorizon: new THREE.Color(0xbcae9a),
    fogTint: new THREE.Color(0xbcae9a),
    shadeTint: new THREE.Color(0x5a6e86),
    sunIntensity: 1.9,
    ambientIntensity: 0.95,
    fogNear: 90,
    fogFar: 360,
    exposure: 1.02,
    tempContrast: 0.12,
  },
  {
    // golden evening: cycleT 0.46. Warm low raking setting sun (pre-dusk).
    t: 0.46,
    sunTint: new THREE.Color(0xffb070),
    ambientTint: new THREE.Color(0x6a5078),
    skyZenith: new THREE.Color(0x4a3560),
    skyHorizon: new THREE.Color(0x9a7060),
    fogTint: new THREE.Color(0x9a7060),
    shadeTint: new THREE.Color(0x4a3a5e), // strongest
    sunIntensity: 1.5,
    ambientIntensity: 0.8,
    fogNear: 80,
    fogFar: 320,
    exposure: 1.05,
    tempContrast: 0.25,
  },
  {
    // blue hour: cycleT 0.56. Cold blue-grey twilight just after dusk.
    t: 0.56,
    sunTint: new THREE.Color(0x7080a0),
    ambientTint: new THREE.Color(0x3a3a58),
    skyZenith: new THREE.Color(0x2a2a48),
    skyHorizon: new THREE.Color(0x5a5a78),
    fogTint: new THREE.Color(0x5a5a78),
    shadeTint: new THREE.Color(0x2a3a58),
    sunIntensity: 0.5,
    ambientIntensity: 0.45,
    fogNear: 72,
    fogFar: 285,
    exposure: 0.95,
    tempContrast: 0.2,
  },
  {
    // night: cycleT 0.75. EXACT anchor (regression-stable, moon tint).
    t: 0.75,
    sunTint: new THREE.Color(0x5070ff),
    ambientTint: new THREE.Color(0x20203a), // floor keeps cel bands readable
    skyZenith: new THREE.Color(0x05060f),
    skyHorizon: new THREE.Color(0x1a1a25), // matches FOG_TINTS night
    fogTint: new THREE.Color(0x1a1a25),
    shadeTint: new THREE.Color(0x20203a), // cool-dominant, matches ambient floor tint
    sunIntensity: 0.15,
    ambientIntensity: 0.3,
    fogNear: 70,
    fogFar: 280,
    exposure: 0.9,
    tempContrast: 0.15,
  },
  {
    // night-end: cycleT 0.90. Late night shifting toward dawn (keep dark).
    t: 0.9,
    sunTint: new THREE.Color(0x4060e0),
    ambientTint: new THREE.Color(0x28284a),
    skyZenith: new THREE.Color(0x080a18),
    skyHorizon: new THREE.Color(0x202030),
    fogTint: new THREE.Color(0x202030),
    shadeTint: new THREE.Color(0x282848),
    sunIntensity: 0.12,
    ambientIntensity: 0.28,
    fogNear: 70,
    fogFar: 280,
    exposure: 0.9,
    tempContrast: 0.12,
  },
];

/** cycleT positions of the keyframes, derived from {@link KEYFRAMES}. */
const KEY_TS: readonly number[] = KEYFRAMES.map((k) => k.t);

/** Sky phase bucket derived from sun elevation + rise/set direction. */
export type SkyPhase = "dawn" | "day" | "dusk" | "night";

/**
 * Options for {@link computeDayCycle}. All optional; defaults come from the 010
 * plan. `dawnDeg` is the twilight/day elevation boundary (default 8 deg).
 */
export interface DayCycleOptions {
  /** Full cycle length in seconds (default 120). */
  dayLengthSeconds?: number;
  /** Peak sun elevation in degrees (default 62). */
  maxElevationDeg?: number;
  /** Elevation in deg at/below which the sky is twilight, not day (default 8). */
  dawnDeg?: number;
  /**
   * Initial elapsed seconds the driver starts from (default 0 = dawn). Pass
   * daytimeStartSeconds() to start a session lit (mid-morning) instead of at
   * dawn; only the driver (DynamicSky) reads this, not the pure compute fn.
   */
  dayStartSeconds?: number;
}

/**
 * Time-of-day state the Renderer + DynamicSky read each frame. The pure
 * {@link computeDayCycle} returns a fresh state shell whose Color/Vector3
 * fields alias module-level scratch (overwritten on the next call); the
 * shared {@link dayCycleState} singleton is the live one DynamicSky writes.
 *
 * Color fields store the raw phase tint only: sun/ambient are LINEAR and the
 * Renderer multiplies by the matching intensity scalar; sky/fog are
 * sRGB-origin THREE.Color forwarded to the sky-posterize slots + scene fog.
 * All colors are built via `new THREE.Color(srgbHex)` so ColorManagement
 * handles the sRGB->LINEAR conversion consistently.
 */
export interface DayCycleState {
  /** Seconds since cycle start, wrapped to [0, dayLengthSeconds). */
  elapsed: number;
  /**
   * Normalized cycle time 0..1 (dawn=0, noon=0.25, dusk=0.5, deep
   * night=0.75); drives phase-mixed consumers (e.g. the 064 post grade)
   * that need dayCycle's exact smoothstep blend.
   */
  cycleT: number;
  /** Current sun elevation in degrees (negative when below the horizon). */
  sunElevationDeg: number;
  /** Current sun azimuth in degrees (90 = east, 180 = south, 270 = west). */
  sunAzimuthDeg: number;
  /** Unit world-space sun direction (mirrors lightUniforms.ts:13-17). */
  sunDirWorld: THREE.Vector3;
  /** Discrete phase bucket (drives any per-phase branching in consumers). */
  phase: SkyPhase;
  /** 0 in full day, 1 in deep night; ramps over 10 deg below the horizon. */
  nightFactor: number;
  /** Sun/moon light tint (LINEAR); multiply by sunIntensity for the final. */
  sunColor: THREE.Color;
  /** Sun/moon light intensity scalar (day 2.0, night ~0.15). */
  sunIntensity: number;
  /** Ambient/hemisphere tint (LINEAR); multiply by ambientIntensity. */
  ambientColor: THREE.Color;
  /** Ambient intensity scalar (day 1.0, night floor 0.3). */
  ambientIntensity: number;
  /** Sky zenith band tint; forwarded to skyPosterize uSkyZenith. */
  skyZenith: THREE.Color;
  /** Sky horizon band tint; forwarded to skyPosterize uSkyHorizon. */
  skyHorizon: THREE.Color;
  /** Fog color; forwarded to scene.fog.color. */
  fogColor: THREE.Color;
  /** Fog near distance (day 90, dusk/night ~70). */
  fogNear: number;
  /** Fog far distance (day 360, dusk/night ~280). */
  fogFar: number;
  /** Cast-shadow fade 0..1 from elevation (0 below 3 deg, 1 above 18 deg). */
  shadowFade: number;
  /**
   * Cool sky tint unlit regions lean toward (LINEAR); Renderer forwards to
   * lightUniforms uShadeTint.
   */
  shadeTint: THREE.Color;
  /** Warm-sun/cool-shade separation strength 0..~0.25 (noon 0, golden hours ~0.25). */
  tempContrast: number;
  /**
   * Tone-mapping exposure scalar (noon 1.0, golden ~1.05, blue hour ~0.95,
   * night ~0.9); Renderer writes renderer.toneMappingExposure each frame.
   */
  exposure: number;
}

/**
 * Map a sun elevation + rise/set flag to a single {@link SkyPhase}. Pure and
 * deterministic. Thresholds: night when elev < 0, twilight (dawn/dusk) when
 * elev < 8, day when elev >= 8. The rise/set flag splits twilight: rising is
 * dawn, setting is dusk. A single elevation maps to exactly one phase.
 */
export function phaseFor(sunElevationDeg: number, isRising: boolean): SkyPhase {
  return phaseForWith(sunElevationDeg, isRising, DAWN_DEG);
}

/**
 * Elevation-driven cast-shadow visibility ramp. Returns 0 below
 * SHADOW_FADE_LOW (3 deg), 1 above SHADOW_FADE_HIGH (18 deg), smoothstep in
 * between. Symmetric dawn/dusk: depends only on elevation, not rise/set.
 * Drives the cel uShadowFade uniform + the Renderer castShadow gate.
 */
export function shadowFadeFor(elevDeg: number): number {
  return smoothstep(SHADOW_FADE_LOW, SHADOW_FADE_HIGH, elevDeg);
}

/**
 * Compute the full day-cycle state for an elapsed time. Pure modulo the
 * pooled Color/Vector3 scratch: returns a fresh {@link DayCycleState} shell
 * whose Color/Vector3 fields alias module-level scratch that is overwritten
 * on the next call. Callers that retain a field past the next call must copy
 * it (the singleton + every return value share the same scratch refs). Never
 * mutates the keyframe tables. Drives the {@link dayCycleState} singleton
 * and the Renderer lighting/sky/fog writes.
 */
// Pooled per-frame scratch for computeDayCycle Color/Vector3 outputs.
// computeDayCycle runs once/frame from DynamicSky and overwrites these in
// place; the returned state (and the dayCycleState singleton) alias them, so
// any consumer that retains a value past the next call must copy it.
const scratchSunDir = new THREE.Vector3();
const scratchSunColor = new THREE.Color();
const scratchAmbientColor = new THREE.Color();
const scratchSkyZenith = new THREE.Color();
const scratchSkyHorizon = new THREE.Color();
const scratchFogColor = new THREE.Color();
const scratchShadeTint = new THREE.Color();

export function computeDayCycle(elapsed: number, opts: DayCycleOptions = {}): DayCycleState {
  const dayLength = opts.dayLengthSeconds ?? DEFAULT_DAY_LENGTH;
  const maxElev = opts.maxElevationDeg ?? MAX_ELEV;
  const dawnDeg = opts.dawnDeg ?? DAWN_DEG;

  const wrapped = mod(elapsed, dayLength);
  const cycleT = mod(elapsed / dayLength, 1);
  const elevDeg = Math.sin(cycleT * TAU) * maxElev;
  const isRising = cycleT < 0.5;
  const azimuthDeg = mod(90 + cycleT * 360, 360);
  const phase = phaseForWith(elevDeg, isRising, dawnDeg);

  // Mirrors lightUniforms.ts:13-17: phi from elevation off +Y, theta from
  // azimuth around +Y. setFromSphericalCoords(r, phi, theta).
  const phi = degToRad(90 - elevDeg);
  const theta = degToRad(azimuthDeg);
  const sunDirWorld = scratchSunDir.setFromSphericalCoords(1, phi, theta);

  return {
    elapsed: wrapped,
    cycleT,
    sunElevationDeg: elevDeg,
    sunAzimuthDeg: azimuthDeg,
    sunDirWorld,
    phase,
    nightFactor: clamp01(-elevDeg / 10),
    sunColor: lerpKeyColor((k) => k.sunTint, cycleT, scratchSunColor),
    sunIntensity: lerpKeyNum((k) => k.sunIntensity, cycleT),
    ambientColor: lerpKeyColor((k) => k.ambientTint, cycleT, scratchAmbientColor),
    ambientIntensity: lerpKeyNum((k) => k.ambientIntensity, cycleT),
    skyZenith: lerpKeyColor((k) => k.skyZenith, cycleT, scratchSkyZenith),
    skyHorizon: lerpKeyColor((k) => k.skyHorizon, cycleT, scratchSkyHorizon),
    fogColor: lerpKeyColor((k) => k.fogTint, cycleT, scratchFogColor),
    fogNear: lerpKeyNum((k) => k.fogNear, cycleT),
    fogFar: lerpKeyNum((k) => k.fogFar, cycleT),
    shadowFade: shadowFadeFor(elevDeg),
    shadeTint: lerpKeyColor((k) => k.shadeTint, cycleT, scratchShadeTint),
    tempContrast: lerpKeyNum((k) => k.tempContrast, cycleT),
    exposure: lerpKeyNum((k) => k.exposure, cycleT),
  };
}

/**
 * Shared mutable day-cycle singleton paralleling `lightUniforms`. Initialized
 * to dawn (elapsed 0) at module load. DynamicSky advances the clock and
 * writes this each frame; the Renderer reads it in its existing per-view
 * lighting/sky/fog write. The Vector3/Color fields alias the same pooled
 * scratch {@link computeDayCycle} writes into, so they are overwritten in
 * place each frame — consumers must copy any value they retain past the
 * next write.
 */
export const dayCycleState: DayCycleState = computeDayCycle(0);

/**
 * Receiver shape for {@link applyDayCycleToTargets}: the renderer's live
 * Three.js objects a day-cycle state is copied into. Every Color/Vector3
 * field is mutated in place (never swapped) so the caller's persistent object
 * identities keep their bindings — mirrors the updateLightUniforms precedent
 * in materials/lightUniforms. `fog` exposes only the scalar near/far pair
 * (THREE.Fog satisfies this structurally); its color is forwarded separately
 * via {@link DayCycleLightTargets.fogColor}.
 */
export interface DayCycleLightTargets {
  /** DirectionalLight color (LINEAR tint; intensity applied by the caller). */
  sunColor: THREE.Color;
  /** HemisphereLight sky color (LINEAR tint; intensity applied by the caller). */
  ambientColor: THREE.Color;
  /** scene.fog color. */
  fogColor: THREE.Color;
  /** scene.fog near/far distances. */
  fog: { near: number; far: number };
  /** World-space sun dir (feeds lightUniforms.uSunDirWorld + Sky sunPosition). */
  sunDirWorld: THREE.Vector3;
  /** Sky zenith band tint (sRGB; fanned out to each skyPosterize slot). */
  skyZenith: THREE.Color;
  /** Sky horizon band tint (sRGB; fanned out to each skyPosterize slot). */
  skyHorizon: THREE.Color;
}

/**
 * Copy a {@link DayCycleState} into the renderer's persistent Three.js
 * targets. Pure except for mutating `dest` (same contract as
 * updateLightUniforms): every Color/Vector3 is copied in place so the
 * caller's object identities are preserved across frames. Light intensity
 * scalars and the per-slot sky-posterize fan-out are intentionally NOT here
 * — the renderer applies those directly (they do not share this single-target
 * shape). No WebGL, so this is unit-testable under jsdom.
 */
export function applyDayCycleToTargets(state: DayCycleState, dest: DayCycleLightTargets): void {
  dest.sunColor.copy(state.sunColor);
  dest.ambientColor.copy(state.ambientColor);
  dest.fogColor.copy(state.fogColor);
  dest.fog.near = state.fogNear;
  dest.fog.far = state.fogFar;
  dest.sunDirWorld.copy(state.sunDirWorld);
  dest.skyZenith.copy(state.skyZenith);
  dest.skyHorizon.copy(state.skyHorizon);
}

// --- internal helpers ------------------------------------------------------

/** Euclidean modulo that returns a non-negative result for negative inputs. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** phaseFor with a configurable twilight/day boundary (honors opts.dawnDeg). */
function phaseForWith(sunElevationDeg: number, isRising: boolean, dayDeg: number): SkyPhase {
  if (sunElevationDeg < NIGHT_ELEV) return "night";
  if (sunElevationDeg < dayDeg) return isRising ? "dawn" : "dusk";
  return "day";
}

/**
 * Keyframe segment + smoothstep blend factor for a normalized cycle time.
 * Finds the segment [from,to] whose t-range contains cycleT; a cycleT exactly
 * equal to a keyframe's t lands on that keyframe (s=0, segment boundary), so
 * anchor positions reproduce their keyframe values exactly. The wrap segment
 * runs from the last keyframe to the first across cycleT=1.0==0.0.
 */
function segmentBlend(cycleT: number): { from: number; to: number; s: number } {
  const last = KEYFRAMES.length - 1;
  // Wrap segment: last keyframe -> first across cycleT=1.0==0.0.
  if (cycleT >= KEY_TS[last]) {
    const span = 1 - KEY_TS[last] + KEY_TS[0];
    return { from: last, to: 0, s: smoothstep(0, 1, (cycleT - KEY_TS[last]) / span) };
  }
  for (let i = 0; i < last; i++) {
    if (cycleT < KEY_TS[i + 1]) {
      const span = KEY_TS[i + 1] - KEY_TS[i];
      return { from: i, to: i + 1, s: smoothstep(0, 1, (cycleT - KEY_TS[i]) / span) };
    }
  }
  return { from: last, to: last, s: 0 };
}

/** Smoothstep-interpolate a numeric keyframe field over the cycle. Pure. */
function lerpKeyNum(getter: (k: DayKeyframe) => number, cycleT: number): number {
  const { from, to, s } = segmentBlend(cycleT);
  const a = getter(KEYFRAMES[from]);
  return a + (getter(KEYFRAMES[to]) - a) * s;
}

/** Smoothstep-interpolate a color keyframe field into the output color. Pure. */
function lerpKeyColor(
  getter: (k: DayKeyframe) => THREE.Color,
  cycleT: number,
  out: THREE.Color,
): THREE.Color {
  const { from, to, s } = segmentBlend(cycleT);
  return out.copy(getter(KEYFRAMES[from])).lerp(getter(KEYFRAMES[to]), s);
}
