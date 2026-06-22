/**
 * 007 AI driver personalities. Each rival gets a deterministic tuning derived
 * from a base seed + its kart index (via makeRNG), so a given seed reproduces
 * the same field every run. Values stay inside the 007 Defaults bands.
 */

import { makeRNG } from "../core/rng";

export interface AiTuning {
  /** Lookahead distance (m) at near-zero speed. */
  lookaheadNear: number;
  /** Lookahead distance (m) at top speed. */
  lookaheadFar: number;
  /** Throttle aggression 0..1 (higher brakes later in corners). */
  aggression: number;
  /** Target-speed scale vs the kart maxSpeed (rubber-band modulates this). */
  maxSpeedScale: number;
  /** Rival repulsion radius (m). */
  avoidRadius: number;
  /** Below this forward speed (m/s) a kart counts as stuck. */
  stuckSpeed: number;
  /** Seconds slow + off-corridor before a reset is requested. */
  stuckTime: number;
}

/** Reference top speed for the speed->lookahead mapping (P1 DEFAULT_TUNING). */
export const AI_REF_MAX_SPEED = 34;

/** Base defaults (centre of each band); makeAiTuning jitters around these. */
export const DEFAULT_AI_TUNING: AiTuning = {
  lookaheadNear: 6,
  lookaheadFar: 14,
  aggression: 0.85,
  maxSpeedScale: 0.96,
  avoidRadius: 4,
  stuckSpeed: 2,
  stuckTime: 2,
};

/**
 * Build a deterministic per-kart tuning. Same (baseSeed, kartIndex) always
 * yields the same personality. Bands match the 007 Defaults.
 */
export function makeAiTuning(baseSeed: number, kartIndex: number): AiTuning {
  const rng = makeRNG((baseSeed ^ Math.imul(kartIndex + 1, 0x9e3779b1)) >>> 0);
  return {
    lookaheadNear: rng.range(5, 7),
    lookaheadFar: rng.range(12, 16),
    aggression: rng.range(0.7, 1.0),
    maxSpeedScale: rng.range(0.92, 1.0),
    avoidRadius: rng.range(3.5, 4.5),
    stuckSpeed: DEFAULT_AI_TUNING.stuckSpeed,
    stuckTime: DEFAULT_AI_TUNING.stuckTime,
  };
}

/** Apply a rubber-band scale (from RaceManager) on top of a tuning copy. */
export function withSpeedScale(base: AiTuning, scale: number): AiTuning {
  return { ...base, maxSpeedScale: Math.max(0.7, base.maxSpeedScale * scale) };
}
