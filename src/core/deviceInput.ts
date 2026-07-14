/**
 * Device-input helpers for mobile touch play: coarse-pointer detection plus the
 * pure tilt -> steer math used by the touch driving overlay (src/ui/TouchControls).
 *
 * Split from the DOM/event orchestration so the math is jsdom-testable and free
 * of listeners: TouchControls owns the `deviceorientation` listener + baseline
 * capture and calls these to convert a raw tilt reading into a `KartInput.steer`.
 *
 * Steering sign follows the single engine convention (positive steer = turn
 * LEFT; see docs/knowledge/conventions/steering-sign.md): rolling the phone's
 * right edge down turns right (negative steer). Per-orientation axis choice is
 * best-effort — the user-facing INVERT toggle is the safety valve when a device
 * reports a flipped sign, which is why the exact axis math is not load-bearing.
 */

import { clamp, sign } from "./math";

/** Tilt tuning. `sensitivity` scales the response; `invert` flips the sign. */
export interface TiltOptions {
  /** Response scale; 1 = full lock near `maxDeg` of tilt. Clamped by caller UI. */
  sensitivity: number;
  /** Flip the steer sign (device/orientation reports opposite of expected). */
  invert: boolean;
  /** Tilt magnitude (deg) ignored around the baseline before steering engages. */
  deadzoneDeg?: number;
  /** Tilt magnitude (deg) that maps to full lock at sensitivity 1. */
  maxDeg?: number;
}

const DEFAULT_DEADZONE_DEG = 5;
const DEFAULT_MAX_DEG = 35;

/**
 * True when the current environment looks like a touch device (phone/tablet).
 * Guards `navigator`/`matchMedia` so it is safe under jsdom/SSR (returns false).
 * Mirrors the CSS `(pointer: coarse)` gate the menu kit already uses.
 */
export function isTouchDevice(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number") {
    if (navigator.maxTouchPoints > 0) return true;
  }
  if (typeof matchMedia === "function") {
    try {
      if (matchMedia("(pointer: coarse)").matches) return true;
    } catch {
      // jsdom's matchMedia stub can throw on some queries; treat as non-touch.
    }
  }
  return false;
}

/**
 * Pick the left/right "roll" angle (deg) from a DeviceOrientation reading given
 * the current `screen.orientation.angle`. Returns a value where positive means
 * the device's right edge is rolled down (from the player's view), consistent
 * across portrait and both landscape rotations:
 * - 0   (portrait):            gamma
 * - 180 (portrait upside down): -gamma
 * - 90  (landscape):           -beta
 * - 270/-90 (landscape other): beta
 * Any other angle falls back to gamma. Calibration + INVERT absorb residual
 * per-device sign quirks, so this only needs to be right up to that flip.
 */
export function pickTiltAngle(orientationAngle: number, beta: number, gamma: number): number {
  const a = ((Math.round(orientationAngle) % 360) + 360) % 360;
  switch (a) {
    case 90:
      return -beta;
    case 180:
      return -gamma;
    case 270:
      return beta;
    default:
      return gamma;
  }
}

/**
 * Convert a roll angle (deg, from {@link pickTiltAngle}) into a steer axis in
 * [-1, 1] relative to a captured `baselineDeg` (the neutral hold angle). Applies
 * a deadzone, scales by `sensitivity` over `maxDeg`, clamps, and maps rolling
 * right -> negative steer (turn right) per the engine convention; `invert` flips
 * it. Pure: no DOM, no listeners.
 */
export function tiltToSteer(angleDeg: number, baselineDeg: number, opts: TiltOptions): number {
  const deadzone = opts.deadzoneDeg ?? DEFAULT_DEADZONE_DEG;
  const maxDeg = opts.maxDeg ?? DEFAULT_MAX_DEG;
  const delta = angleDeg - baselineDeg;
  const mag = Math.abs(delta) - deadzone;
  if (mag <= 0) return 0;
  const span = Math.max(1e-3, maxDeg - deadzone);
  const norm = clamp((mag / span) * opts.sensitivity, 0, 1);
  // Roll right (delta > 0) turns right -> negative steer (convention: +=left).
  let steer = -sign(delta) * norm;
  if (opts.invert) steer = -steer;
  return steer;
}
