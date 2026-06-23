import * as THREE from "three";
import { degToRad } from "../core/math";
import { clamp01, smoothstep } from "../core/rng";

/**
 * 010 Dynamic sky: pure time-of-day driver.
 *
 * Computes a full day-cycle state (sun arc, phase, color + intensity + fog
 * curves) from an elapsed time. Mirrors the lightUniforms precedent (pure
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

/** Peak sun elevation in degrees (sine amplitude of the arc). */
const MAX_ELEV = 62;

/** Elevation in deg at/below which the sky reads as twilight (dawn/dusk). */
const DAWN_DEG = 8;

/** Elevation in deg below which the sun is under the horizon (night begins). */
const NIGHT_ELEV = 0;

/** cycleT positions of the four phase keyframes: dawn/day/dusk/night. */
const KEY_TS: readonly number[] = [0, 0.25, 0.5, 0.75];

// Per-phase key tints (sRGB hex -> LINEAR THREE.Color via default
// ColorManagement). Indices: [dawn, day, dusk, night]. sun/ambient tints feed
// lighting; sky/fog tints feed the Renderer sky-posterize slots + scene fog.
const SUN_TINTS: readonly THREE.Color[] = [
  new THREE.Color(0xffd9a0), // dawn
  new THREE.Color(0xffe8b0), // day  (matches Renderer DirectionalLight)
  new THREE.Color(0xff9050), // dusk
  new THREE.Color(0x5070ff), // night (moon tint)
];
const AMBIENT_TINTS: readonly THREE.Color[] = [
  new THREE.Color(0x4a4a6a), // dawn
  new THREE.Color(0x8090a0), // day  (matches Renderer HemisphereLight)
  new THREE.Color(0x5a4070), // dusk
  new THREE.Color(0x20203a), // night (floor keeps cel bands readable)
];
const SKY_ZENITH_TINTS: readonly THREE.Color[] = [
  new THREE.Color(0x6a6a9a), // dawn
  new THREE.Color(0x4a8fcf), // day  (matches skyPosterize default)
  new THREE.Color(0x4a3050), // dusk
  new THREE.Color(0x05060f), // night
];
const SKY_HORIZON_TINTS: readonly THREE.Color[] = [
  new THREE.Color(0xffd0a0), // dawn
  new THREE.Color(0xfde8c0), // day  (matches skyPosterize default)
  new THREE.Color(0xff8050), // dusk
  new THREE.Color(0x1a2035), // night
];
const FOG_TINTS: readonly THREE.Color[] = [
  new THREE.Color(0xd0c0a8), // dawn
  new THREE.Color(0xb6ad9e), // day  (matches Renderer scene.fog)
  new THREE.Color(0x806050), // dusk
  new THREE.Color(0x1a1a25), // night
];

// Per-phase scalar curves (indices: dawn, day, dusk, night). sun/ambient
// intensities match the Renderer light defaults at day; night keeps a floor so
// the cel ramp does not crush. Fog pulls closer at dusk/night for moodiness.
const SUN_INTENSITY: readonly number[] = [1.2, 2.0, 1.2, 0.15];
const AMBIENT_INTENSITY: readonly number[] = [0.6, 1.0, 0.6, 0.3];
const FOG_NEAR: readonly number[] = [90, 90, 70, 70];
const FOG_FAR: readonly number[] = [360, 360, 280, 280];

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
}

/**
 * Time-of-day state the Renderer + DynamicSky read each frame. The pure
 * {@link computeDayCycle} returns a fresh object every call; the shared
 * {@link dayCycleState} singleton is the live one DynamicSky writes.
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
 * Compute the full day-cycle state for an elapsed time. Pure: returns a fresh
 * {@link DayCycleState} every call and never mutates the singleton or the
 * keyframe tables. Drives the {@link dayCycleState} singleton and (in later
 * commits) the Renderer lighting/sky/fog writes.
 */
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
  const sunDirWorld = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

  return {
    elapsed: wrapped,
    sunElevationDeg: elevDeg,
    sunAzimuthDeg: azimuthDeg,
    sunDirWorld,
    phase,
    nightFactor: clamp01(-elevDeg / 10),
    sunColor: lerpKeyColor(SUN_TINTS, cycleT, new THREE.Color()),
    sunIntensity: lerpKeyNum(SUN_INTENSITY, cycleT),
    ambientColor: lerpKeyColor(AMBIENT_TINTS, cycleT, new THREE.Color()),
    ambientIntensity: lerpKeyNum(AMBIENT_INTENSITY, cycleT),
    skyZenith: lerpKeyColor(SKY_ZENITH_TINTS, cycleT, new THREE.Color()),
    skyHorizon: lerpKeyColor(SKY_HORIZON_TINTS, cycleT, new THREE.Color()),
    fogColor: lerpKeyColor(FOG_TINTS, cycleT, new THREE.Color()),
    fogNear: lerpKeyNum(FOG_NEAR, cycleT),
    fogFar: lerpKeyNum(FOG_FAR, cycleT),
  };
}

/**
 * Shared mutable day-cycle singleton paralleling `lightUniforms`. Initialized
 * to dawn (elapsed 0) at module load. DynamicSky (later commit) advances the
 * clock and writes this each frame; the Renderer reads it in its existing
 * per-view lighting/sky/fog write. The Vector3/Color fields are replaced (not
 * reused) on each write, so consumers must copy any value they retain.
 */
export const dayCycleState: DayCycleState = computeDayCycle(0);

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

/** Keyframe segment + smoothstep blend factor for a normalized cycle time. */
function segmentBlend(cycleT: number): { from: number; to: number; s: number } {
  // Wrap segment: night (t=0.75) -> dawn (t=1 == 0).
  if (cycleT >= KEY_TS[3]) {
    return { from: 3, to: 0, s: smoothstep(0, 1, (cycleT - KEY_TS[3]) / 0.25) };
  }
  for (let i = 0; i < 3; i++) {
    if (cycleT < KEY_TS[i + 1]) {
      const span = KEY_TS[i + 1] - KEY_TS[i];
      return { from: i, to: i + 1, s: smoothstep(0, 1, (cycleT - KEY_TS[i]) / span) };
    }
  }
  return { from: 3, to: 3, s: 0 };
}

/** Smoothstep-interpolate a numeric keyframe table over the cycle. */
function lerpKeyNum(values: readonly number[], cycleT: number): number {
  const { from, to, s } = segmentBlend(cycleT);
  return values[from] + (values[to] - values[from]) * s;
}

/** Smoothstep-interpolate a color keyframe table into the output color. */
function lerpKeyColor(
  colors: readonly THREE.Color[],
  cycleT: number,
  out: THREE.Color,
): THREE.Color {
  const { from, to, s } = segmentBlend(cycleT);
  return out.copy(colors[from]).lerp(colors[to], s);
}
