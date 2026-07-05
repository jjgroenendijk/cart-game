/**
 * 059 variable road width. Pure seeded generator: a few low-frequency
 * harmonics (integer cycle counts -> seam-continuous on the closed loop)
 * swing the half-width across the biome's [widthMin, widthMax] band, then
 * three invariants are enforced:
 *
 * - band clamp: widthMin <= hw <= widthMax everywhere;
 * - start-zone floor: t in [0.93, 1) u [0, 0.03] keeps hw >= 6 so the
 *   2-column start grid (lateral 2.0 straddle) always fits;
 * - slope clamp: |d hw / d s| <= WIDTH_SLOPE_MAX via raise-only relaxation
 *   passes (raising preserves both floors; values stay bounded by the band
 *   max because a raise never exceeds its neighbor).
 *
 * jsdom-safe (no three/WebGL).
 */

import { makeRNG } from "../core/rng";
import type { WidthProfile } from "./trackGraph";
import { DEFAULT_TRACK_TRAITS, type TrackTraits } from "./trackTraits";

/** Target width-station spacing along the loop (m). */
export const WIDTH_STATION_STEP = 10;
/** Max half-width change per metre of arc (keeps edge lines calm). */
export const WIDTH_SLOPE_MAX = 0.03;
/** Start-zone half-width floor (m): the 2-column grid must fit. */
export const START_MIN_HALF_WIDTH = 6;
/** Start zone in lap fraction: [from, 1) u [0, to] around the line. */
export const START_ZONE = { from: 0.93, to: 0.03 } as const;

const TWO_PI = Math.PI * 2;

/**
 * Seed -> per-station width profile for a closed loop of `length` m.
 * Deterministic in (seed, length, traits); independent of the mainline
 * geometry draw so a taming retry never changes the width character.
 */
export function generateWidthProfile(
  seed: number,
  length: number,
  traits: TrackTraits = DEFAULT_TRACK_TRAITS,
): WidthProfile {
  const rng = makeRNG(Math.imul((seed >>> 0) ^ 0x51ab3f2d, 0x9e3779b1) >>> 0 || 1);
  const count = Math.max(8, Math.round(length / WIDTH_STATION_STEP));
  const step = length / count;
  const mid = (traits.widthMin + traits.widthMax) / 2;
  const amp = (traits.widthVariation * (traits.widthMax - traits.widthMin)) / 2;

  // 2-3 harmonics with integer cycle counts (closed-loop continuity) and
  // 1/k falloff so the lowest frequency dominates (broad swells, not jitter).
  const harmonics: Array<{ k: number; phase: number; w: number }> = [];
  const hCount = 2 + (rng.next() < 0.5 ? 1 : 0);
  let norm = 0;
  for (let h = 0; h < hCount; h++) {
    const k = 1 + Math.floor(rng.next() * 3);
    const w = 1 / (h + 1);
    harmonics.push({ k, phase: rng.range(0, TWO_PI), w });
    norm += w;
  }

  const hw = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const u = i / count;
    let v = 0;
    for (const h of harmonics) v += h.w * Math.sin(TWO_PI * h.k * u + h.phase);
    hw[i] = clamp(mid + (amp * v) / norm, traits.widthMin, traits.widthMax);
  }

  applyStartFloor(hw, count);
  relaxSlope(hw, step);

  const s = new Array<number>(count);
  for (let i = 0; i < count; i++) s[i] = i * step;
  return { s, halfWidth: hw };
}

/** True when lap fraction t sits inside the start zone. */
export function inStartZone(t: number): boolean {
  const w = ((t % 1) + 1) % 1;
  return w >= START_ZONE.from || w <= START_ZONE.to;
}

/** Raise start-zone stations to the grid floor. */
function applyStartFloor(hw: number[], count: number): void {
  for (let i = 0; i < count; i++) {
    if (inStartZone(i / count)) hw[i] = Math.max(hw[i]!, START_MIN_HALF_WIDTH);
  }
}

/**
 * Raise-only slope relaxation on the closed station ring: whenever a
 * neighbor pair drops faster than the slope cap, the LOWER station is
 * raised. Raising preserves the band/start floors; convergence is quick
 * (each pass only propagates ramps outward from maxima).
 */
function relaxSlope(hw: number[], step: number): void {
  const n = hw.length;
  const maxDelta = WIDTH_SLOPE_MAX * step;
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const floorFromI = hw[i]! - maxDelta;
      if (hw[j]! < floorFromI) {
        hw[j] = floorFromI;
        changed = true;
      }
      const floorFromJ = hw[j]! - maxDelta;
      if (hw[i]! < floorFromJ) {
        hw[i] = floorFromJ;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
