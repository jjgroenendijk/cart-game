import { hashSeed, makeRNG } from "../core/rng";

/**
 * 054 commit 4: seeded lightning flash schedule for the storm preset. Pure
 * (no THREE): deterministic from the session seed so the flash + thunder
 * sequence reproduces every run. Environment builds a schedule on storm start
 * and samples {@link activeFlash} each frame to spike dayCycleState; the audio
 * driver walks the same flashes to fire thunder one-shots.
 */

/** Number of flashes generated per schedule (~14-23 min of weather). */
const FLASH_COUNT = 100;
/** First flash lands no earlier than this (comfort ramp-in, seconds). */
const FIRST_FLASH_MIN = 8;
/** Minimum gap between consecutive flashes (comfort floor, seconds). */
const MIN_SPACING = 6;
/** Maximum additional random spacing on top of {@link MIN_SPACING}. */
const SPACING_RANGE = 8;
/** Minimum flash strength (0..1). */
const STRENGTH_MIN = 0.4;
/** Strength random range on top of {@link STRENGTH_MIN}. */
const STRENGTH_RANGE = 0.6;
/** Minimum thunder delay after the flash (sound travel, seconds). */
const THUNDER_DELAY_MIN = 2;
/** Thunder delay random range on top of {@link THUNDER_DELAY_MIN}. */
const THUNDER_DELAY_RANGE = 4;

/** A single scheduled lightning flash + its matching thunder delay. */
export interface LightningFlash {
  /** Absolute schedule time the flash fires (seconds). */
  atSec: number;
  /** Flash brightness 0..1 (drives the dayCycleState intensity spike). */
  strength: number;
  /** Seconds after atSec the thunder rumble is due (sound travel). */
  thunderDelaySec: number;
}

/** Full ordered flash list for one storm front (sorted ascending by atSec). */
export interface LightningSchedule {
  flashes: LightningFlash[];
}

/**
 * Duration a flash illuminates the scene (~5 frames at 60Hz). Within
 * [atSec, atSec + FLASH_DURATION) the flash adds a decaying boost to
 * dayCycleState sun/ambient intensity.
 */
export const FLASH_DURATION = 0.08;

/**
 * Build a deterministic flash schedule from `seed`. Pure: same seed ->
 * same flashes, byte-for-byte. Uses `makeRNG(hashSeed("lightning") ^ seed)`.
 *
 * First flash lands at {@link FIRST_FLASH_MIN}+ seconds; each subsequent
 * flash follows by {@link MIN_SPACING} + rng*{@link SPACING_RANGE} (>= 6s
 * comfort floor). strength in [{@link STRENGTH_MIN}, 1], thunderDelaySec in
 * [{@link THUNDER_DELAY_MIN}, 6]. Flashes are sorted ascending by atSec.
 */
export function makeLightningSchedule(seed: number): LightningSchedule {
  const rng = makeRNG(hashSeed("lightning") ^ seed);
  const flashes: LightningFlash[] = [];
  let at = FIRST_FLASH_MIN + rng.next() * SPACING_RANGE;
  for (let i = 0; i < FLASH_COUNT; i++) {
    const strength = STRENGTH_MIN + rng.next() * STRENGTH_RANGE;
    const thunderDelaySec = THUNDER_DELAY_MIN + rng.next() * THUNDER_DELAY_RANGE;
    flashes.push({ atSec: at, strength, thunderDelaySec });
    at += MIN_SPACING + rng.next() * SPACING_RANGE;
  }
  flashes.sort((a, b) => a.atSec - b.atSec);
  return { flashes };
}

/**
 * Return the flash active at absolute time `t`, else null. A flash is active
 * within [atSec, atSec + {@link FLASH_DURATION}). Linear scan (FLASH_COUNT is
 * small + the schedule is sorted; first match returns). Negative `t` is
 * clamped to 0. Pure: same (schedule, t) -> same result.
 */
export function activeFlash(schedule: LightningSchedule, t: number): LightningFlash | null {
  const tt = t < 0 ? 0 : t;
  for (const f of schedule.flashes) {
    if (tt >= f.atSec && tt < f.atSec + FLASH_DURATION) return f;
  }
  return null;
}
