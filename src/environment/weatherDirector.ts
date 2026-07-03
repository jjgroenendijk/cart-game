import { clamp01, hashSeed, smoothstep } from "../core/rng";
import { selectWeatherPreset, type WeatherPreset } from "./weatherPresets";

/**
 * Director mode for a session's weather schedule. "auto" generates a finite
 * sequence of fronts that fade through zero at every handover; any concrete
 * WeatherPreset is a FIXED mode = one infinite segment at full level
 * (bit-identical to today). "clear" is the degenerate fixed mode whose single
 * segment never builds a field (level 0 forever).
 */
export type WeatherMode = "auto" | WeatherPreset;

/** A single front in a {@link WeatherSchedule}: a trapezoid level envelope. */
export interface WeatherSegment {
  preset: WeatherPreset;
  /** 0->1 ramp duration at the front's start (0 = open at full level). */
  fadeInSec: number;
  /** Full-level dwell AFTER fadeIn, BEFORE fadeOut (Infinity = hold forever). */
  holdSec: number;
  /** 1->0 ramp duration at the front's end (0 with Infinity hold = never fade). */
  fadeOutSec: number;
}

export interface WeatherSchedule {
  segments: WeatherSegment[];
  /**
   * Cumulative absolute start time (seconds) of each segment; length ==
   * segments.length + 1. starts[0] = 0; starts[i+1] = starts[i] + fadeIn[i] +
   * hold[i] + fadeOut[i]. An Infinity hold => every later start is Infinity.
   */
  starts: number[];
}

/** Resolved preset + live level in [0,1] at a given schedule time. */
export interface WeatherLevel {
  preset: WeatherPreset;
  level: number;
}

/** Auto-mode front count: ~12 min of weather at SEG_HOLD_SEC + SEG_FADE_SEC. */
const AUTO_SEGMENTS = 10;
/** Full-level dwell per auto front (seconds). */
const SEG_HOLD_SEC = 70;
/** Fade ramp duration (seconds) used for both in and out auto fronts. */
const SEG_FADE_SEC = 10;

function fixedSchedule(preset: WeatherPreset): WeatherSchedule {
  return {
    segments: [{ preset, fadeInSec: 0, holdSec: Infinity, fadeOutSec: 0 }],
    starts: [0, Infinity],
  };
}

/**
 * Build a deterministic weather schedule from the session seed. Pure: same
 * (seed, weights, mode) -> same schedule, byte-for-byte.
 *
 * FIXED mode (any concrete WeatherPreset, including "clear"): ONE segment at
 * the given preset, hold Infinity -> level 1 forever ("clear" yields level 0
 * forever via {@link levelAt}). This is the DEFAULT Environment mode (the
 * resolved session pick) so a session opens bit-identical to today until a
 * mode opts in.
 *
 * AUTO mode: {@link AUTO_SEGMENTS} fronts. Segment 0 preset MUST equal
 * {@link selectWeatherPreset}(weights, seed) so an auto session opens with the
 * same weather as the fixed session pick, at full level 1 (fadeIn 0). Each
 * later segment re-rolls with a per-segment sub-seed
 * `selectWeatherPreset(weights, seed ^ hashSeed("weather-seg" + i))` (same XOR
 * idiom as Weather.buildField's particle init). The LAST segment holds
 * forever (Infinity) so the schedule never runs out of weather.
 */
export function makeSchedule(
  seed: number,
  weights: Readonly<Record<string, number>>,
  mode: WeatherMode,
): WeatherSchedule {
  if (mode !== "auto") {
    return fixedSchedule(mode);
  }
  const segments: WeatherSegment[] = [];
  const starts: number[] = [0];
  const lastIndex = AUTO_SEGMENTS - 1;
  for (let i = 0; i < AUTO_SEGMENTS; i++) {
    const preset =
      i === 0
        ? selectWeatherPreset(weights, seed)
        : selectWeatherPreset(weights, seed ^ hashSeed("weather-seg" + i));
    const isLast = i === lastIndex;
    const seg: WeatherSegment = {
      preset,
      fadeInSec: i === 0 ? 0 : SEG_FADE_SEC,
      holdSec: isLast ? Infinity : SEG_HOLD_SEC,
      fadeOutSec: isLast ? 0 : SEG_FADE_SEC,
    };
    segments.push(seg);
    // Infinity hold => every later start is Infinity (Infinity + n = Infinity).
    starts.push(starts[i]! + seg.fadeInSec + seg.holdSec + seg.fadeOutSec);
  }
  return { segments, starts };
}

/**
 * Resolve the active preset + level at absolute schedule time `t`. Pure and
 * deterministic: same (schedule, t) -> same result. Negative `t` is clamped
 * to 0 (segment 0 start).
 *
 * Each segment is a trapezoid: smoothstep 0->1 across fadeIn, full level 1
 * across hold, smoothstep 1->0 across fadeOut. Infinity hold never leaves
 * level 1; fadeIn 0 opens at 1; "clear" preset yields level 0 always. Preset
 * transitions happen ONLY at segment boundaries, where level is exactly 0 by
 * construction (a segment's fadeOut end meets the next segment's fadeIn start
 * at level 0).
 */
export function levelAt(schedule: WeatherSchedule, t: number): WeatherLevel {
  const tt = t < 0 ? 0 : t;
  const { segments, starts } = schedule;
  // Locate the active segment: the last whose start <= tt. The loop only scans
  // starts[0..segments.length-1] (segment starts); starts[segments.length] is
  // the schedule total (Infinity for the holding last segment) and never an
  // active segment start, so the index stays in range.
  let idx = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    if (starts[i]! <= tt) idx = i;
    else break;
  }
  const seg = segments[idx]!;
  const local = tt - starts[idx]!;
  if (seg.preset === "clear") {
    return { preset: "clear", level: 0 };
  }
  const fadeOutStart = seg.fadeInSec + seg.holdSec;
  // Hold region (covers fadeIn 0, Infinity hold, and the last segment).
  if (local >= seg.fadeInSec && local < fadeOutStart) {
    return { preset: seg.preset, level: 1 };
  }
  if (local < seg.fadeInSec) {
    return { preset: seg.preset, level: clamp01(smoothstep(0, seg.fadeInSec, local)) };
  }
  // Fade-out region: smoothstep 1->0 across [fadeOutStart, fadeOutEnd].
  const fadeOutEnd = fadeOutStart + seg.fadeOutSec;
  return { preset: seg.preset, level: clamp01(smoothstep(fadeOutEnd, fadeOutStart, local)) };
}
