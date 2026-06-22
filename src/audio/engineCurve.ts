import { clamp, lerp } from "../core/math";

/**
 * 005 procedural audio: pure 6-gear fake-RPM mapping. No AudioContext -> runs
 * in any env (node/jsdom). AudioManager calls this per frame and applies the
 * result to the engine oscillators + lowpass via setTargetAtTime.
 *
 * Arcade feel: within a gear the rpm rises (local 0->1 lerp low->high); at the
 * shift point to the next gear the freq DROPS to that gear's low (a step down
 * followed by a rise), mimicking a manual box. tierPeak spreads idleHz..topHz
 * geometrically across the 6 gears so each band covers an equal ratio step.
 */

export interface EngineCurveInput {
  /** Signed forward speed (m/s). Negative (reverse) is clamped to 0 (idle). */
  speed: number;
  /** Forward speed at top gear (m/s, from kart tuning). */
  maxSpeed: number;
  /** Throttle in [-1, 1]; <=0 yields idle gain. */
  throttle: number;
}

export interface EngineCurveOptions {
  /** Engine frequency at speed 0 (Hz). */
  idleHz?: number;
  /** Engine frequency at maxSpeed (Hz). */
  topHz?: number;
  /** freq multiplier at the bottom of each gear (local=0). */
  lowRatio?: number;
  /** freq multiplier at the top of each gear (local=1). */
  highRatio?: number;
  /** Engine gain at idle. */
  idleGain?: number;
  /** Engine gain at full throttle. */
  fullGain?: number;
  /** Gear band count (default 6). */
  gears?: number;
}

export interface EngineCurveOutput {
  /** Oscillator base frequency (Hz). Sub-osc plays an octave below. */
  freq: number;
  /** Engine gain (linear, pre-engineActive gate). */
  gain: number;
  /** Active gear index [0..gears-1] for debugging. */
  gear: number;
}

const DEFAULTS: Required<EngineCurveOptions> = {
  idleHz: 55,
  topHz: 320,
  lowRatio: 0.55,
  highRatio: 1.0,
  idleGain: 0.05,
  fullGain: 0.2,
  gears: 6,
};

/**
 * Map speed/throttle to engine oscillator freq + gain across N gear bands.
 * Deterministic and side-effect free.
 */
export function engineCurve(
  input: EngineCurveInput,
  opts: EngineCurveOptions = {},
): EngineCurveOutput {
  const o: Required<EngineCurveOptions> = { ...DEFAULTS, ...opts };
  const gears = o.gears;
  const speed01 = input.maxSpeed > 0 ? clamp(input.speed / input.maxSpeed, 0, 1) : 0;
  const gear = Math.min(gears - 1, Math.floor(speed01 * gears));
  const local = speed01 * gears - gear;
  const tierPeak = o.idleHz * Math.pow(o.topHz / o.idleHz, gear / (gears - 1));
  const freq = tierPeak * lerp(o.lowRatio, o.highRatio, local);
  const gain =
    input.throttle > 0 ? lerp(o.idleGain, o.fullGain, clamp(input.throttle, 0, 1)) : o.idleGain;
  return { freq, gain, gear };
}
