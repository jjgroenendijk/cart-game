/**
 * 059 variable road width. Pure seeded generator: a few low-frequency
 * harmonics (integer cycle counts -> seam-continuous on the closed loop)
 * swing the half-width across the biome's [widthMin, widthMax] band. When
 * the accepted centerline's curvature is supplied, a choreography term is
 * layered on top: corner entries widen, apexes pinch, the start straight
 * stays broad, and the harmonics drop to low-weight texture. Then three
 * invariants are enforced:
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

/**
 * Signed centerline turn rate at uniform arc samples (+ = left). Produced by
 * `centerlineCurvature` in circuit.ts from the accepted control loop; shared
 * by width choreography (and later banking).
 */
export interface CurvatureSeries {
  /** Uniform arc spacing between curvature samples (m). */
  ds: number;
  /** Turn rate per metre at each sample (rad/m, + = left). */
  kappa: Float32Array;
}

/** Target width-station spacing along the loop (m). */
export const WIDTH_STATION_STEP = 10;
/** Max half-width change per metre of arc (keeps edge lines calm). */
export const WIDTH_SLOPE_MAX = 0.045;
/** Start-zone half-width floor (m): the 2-column grid must fit. */
export const START_MIN_HALF_WIDTH = 6;
/** Start zone in lap fraction: [from, 1) u [0, to] around the line. */
export const START_ZONE = { from: 0.93, to: 0.03 } as const;

const TWO_PI = Math.PI * 2;

// Choreography thresholds: corner intensity ramps in from radius 60 m and
// saturates at 24 m; "entry" looks ahead 12-55 m for an upcoming corner.
const CORNER_ONSET_RADIUS = 60;
const CORNER_FULL_RADIUS = 24;
const ENTRY_AHEAD_MIN = 12;
const ENTRY_AHEAD_MAX = 55;
/** Curvature box-smoothing half-window (m) before thresholding. */
const CURV_SMOOTH_HALF = 4.5;
/** Metres past the start line kept at the wide start-straight target. */
const START_WIDE_AFTER = 40;

/**
 * Seed -> per-station width profile for a closed loop of `length` m.
 * Deterministic in (seed, length, traits, curv). The random harmonic draw is
 * seed-only; `curv` (the accepted centerline's curvature) adds the
 * deterministic corner choreography on top.
 */
export function generateWidthProfile(
  seed: number,
  length: number,
  traits: TrackTraits = DEFAULT_TRACK_TRAITS,
  curv?: CurvatureSeries,
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

  const shape = curv ? cornerShape(count, step, curv) : undefined;
  const hw = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const u = i / count;
    let v = 0;
    for (const h of harmonics) v += h.w * Math.sin(TWO_PI * h.k * u + h.phase);
    // With choreography, harmonics drop to low-weight texture so corner
    // shape dominates; without, the legacy pure-harmonic profile.
    const swing = shape ? 0.45 * (v / norm) + shape[i]! : v / norm;
    hw[i] = clamp(mid + amp * swing, traits.widthMin, traits.widthMax);
  }

  if (shape) applyStartWide(hw, count, length, traits.widthMax);
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

/**
 * Per-station choreography term in roughly [-1, 0.9]: corner apexes pinch
 * (full negative), the 12-55 m approach to a corner widens, straights relax
 * to the harmonic base. Wrap-aware on the closed loop.
 */
function cornerShape(count: number, step: number, curv: CurvatureSeries): number[] {
  const n = curv.kappa.length;
  const win = Math.max(1, Math.round(CURV_SMOOTH_HALF / curv.ds));
  const intensity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -win; j <= win; j++) acc += Math.abs(curv.kappa[(i + j + n) % n]!);
    const k = acc / (2 * win + 1);
    intensity[i] = smoothstep(1 / CORNER_ONSET_RADIUS, 1 / CORNER_FULL_RADIUS, k);
  }
  const jLo = Math.max(1, Math.round(ENTRY_AHEAD_MIN / curv.ds));
  const jHi = Math.max(jLo, Math.round(ENTRY_AHEAD_MAX / curv.ds));
  const shape = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const at = Math.round((i * step) / curv.ds) % n;
    let entry = 0;
    for (let j = jLo; j <= jHi; j++) {
      const v = intensity[(at + j) % n]!;
      if (v > entry) entry = v;
    }
    const c = intensity[at]!;
    shape[i] = 0.9 * entry * (1 - c) - c;
  }
  return shape;
}

/**
 * Choreographed start straight: hold the line and the first ~40 m after it
 * at a broad target (grid floor + 2, capped by the band) so the field always
 * launches onto a wide straight before the first squeeze.
 */
function applyStartWide(hw: number[], count: number, length: number, widthMax: number): void {
  const wide = Math.min(widthMax, START_MIN_HALF_WIDTH + 2);
  const after = START_ZONE.to + START_WIDE_AFTER / length;
  for (let i = 0; i < count; i++) {
    const u = i / count;
    if (inStartZone(u) || u <= after) hw[i] = Math.max(hw[i]!, wide);
  }
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

function smoothstep(lo: number, hi: number, v: number): number {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}
