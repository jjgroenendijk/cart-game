/**
 * Pure helpers for accelerometer (DeviceOrientation) steering on phones.
 * MobileControls owns the event wiring + iOS permission gesture; this module
 * holds only the math so it is unit-testable without a device.
 *
 * A phone is normally held in landscape while driving. The physical "steering
 * wheel" tilt maps to a different DeviceOrientationEvent Euler axis depending
 * on screen orientation: portrait rolls about `gamma`, landscape about `beta`.
 * resolveTiltAxis() picks the axis + a sign that makes "drop the right edge"
 * read positive; tiltToSteer() then converts that into the engine steering-sign
 * convention (positive steer = turn LEFT), so tilting right turns right.
 *
 * Signs for the two landscape orientations are the common iOS Safari mapping
 * but can differ per device; MobileControls exposes an `invert` toggle (and
 * calibrates a neutral baseline) so users correct feel without a code change.
 */

export type TiltAxis = "beta" | "gamma";

export interface TiltAxisMap {
  axis: TiltAxis;
  /** Multiplier that turns raw axis degrees into "right-edge-down positive". */
  sign: number;
}

export interface TiltReading {
  beta: number | null;
  gamma: number | null;
}

export interface TiltSteerOptions {
  /** Screen orientation angle (screen.orientation.angle / window.orientation). */
  angle: number;
  /** Calibrated flat-hold baseline on the active axis, in degrees. */
  neutral: number;
  /** Degrees past the deadzone that yield full lock. Default 28. */
  rangeDeg?: number;
  /** Slop around neutral that yields zero steer, in degrees. Default 3. */
  deadzoneDeg?: number;
  /** Flip left/right when a device reports the opposite sign. */
  invert?: boolean;
}

const DEFAULT_RANGE_DEG = 28;
const DEFAULT_DEADZONE_DEG = 3;

/** Snap an arbitrary orientation angle to the nearest 0/90/180/270. */
export function normalizeOrientationAngle(angle: number): 0 | 90 | 180 | 270 {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return a as 0 | 90 | 180 | 270;
}

/** Active tilt axis + right-edge-down sign for the current screen orientation. */
export function resolveTiltAxis(angle: number): TiltAxisMap {
  switch (normalizeOrientationAngle(angle)) {
    case 90:
      return { axis: "beta", sign: 1 };
    case 180:
      return { axis: "gamma", sign: -1 };
    case 270:
      return { axis: "beta", sign: -1 };
    default:
      return { axis: "gamma", sign: 1 };
  }
}

/** Read the active axis (per orientation) from a DeviceOrientation reading. */
export function readTiltAxis(reading: TiltReading, angle: number): number | null {
  const map = resolveTiltAxis(angle);
  return map.axis === "beta" ? reading.beta : reading.gamma;
}

/**
 * Convert a DeviceOrientation reading into a steer value in [-1, 1] following
 * the engine convention (positive = turn left). Returns 0 for a missing axis,
 * inside the deadzone, or a non-finite reading.
 */
export function tiltToSteer(reading: TiltReading, o: TiltSteerOptions): number {
  const map = resolveTiltAxis(o.angle);
  const raw = map.axis === "beta" ? reading.beta : reading.gamma;
  if (raw == null || !Number.isFinite(raw)) return 0;

  const range = o.rangeDeg ?? DEFAULT_RANGE_DEG;
  const dead = o.deadzoneDeg ?? DEFAULT_DEADZONE_DEG;
  // Positive `tilt` = right edge dropped (steer right), flipped by `invert`.
  let tilt = map.sign * (raw - o.neutral);
  if (o.invert) tilt = -tilt;

  const mag = Math.abs(tilt);
  if (mag <= dead) return 0;
  const norm = Math.min((mag - dead) / range, 1);
  // Right tilt -> turn right -> negative steer per the sign convention.
  return -Math.sign(tilt) * norm;
}

/**
 * Whether this device should show touch driving controls: a coarse pointer or
 * a positive touch-point count. Guards jsdom/SSR where matchMedia is absent.
 */
export function isTouchDevice(): boolean {
  if (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0) {
    return true;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  }
  return false;
}
