/**
 * 084 corridor banking. Pure, rng-free: the bank profile is derived entirely
 * from the accepted centerline geometry. Corners bank toward their inside
 * (inside edge low) up to the trait cap, with hard zero masks where a tilted
 * cross-section would break the world:
 *
 * - proximity mask: stations whose sample sits XZ-near an arc-far sample
 *   (hairpin-bay legs, pinched sections) stay level — two nearby corridors
 *   at different edge heights would read as a cliff in the shared blend;
 * - start-zone mask: the gantry, start decal, and grid all assume a level
 *   cross-section around t = 0;
 * - junction mask: branch anchors RIDGE-blend two edges' pathY, so the
 *   corridor must be level within the blend footprint.
 *
 * A toward-zero slope relaxation caps the twist rate so the road never
 * corkscrews; shrinking magnitudes keeps masked zeros exactly zero.
 * jsdom-safe (no three/WebGL).
 */

import { SampleIndex } from "./trackGraph";
import type { BankProfile } from "./stationProfile";
import type { BranchSpec } from "./circuitBranch";

/** Max bank twist rate along the arc (rad/m): ~10 deg over 30 m. */
export const BANK_SLOPE_MAX = (0.35 * Math.PI) / 180;
/** Target bank-station spacing along the loop (m). */
export const BANK_STATION_STEP = 5;

/** Arc-even centerline samples + signed curvature (from circuit.ts). */
export interface BankGenInput {
  x: Float32Array;
  z: Float32Array;
  /** Uniform arc spacing between samples (m). */
  ds: number;
  /** Signed turn rate per sample (rad/m, + = left). */
  kappa: Float32Array;
  /** Loop length (m). */
  length: number;
}

// Bank ramps in from corner radius 90 m and saturates at 30 m; curvature is
// box-smoothed +-12 m first so the sign cannot jitter station-to-station.
const CURV_SMOOTH_HALF = 12;
const BANK_ONSET_RADIUS = 90;
const BANK_FULL_RADIUS = 30;
// Proximity mask: min XZ distance to any sample more than 60 m away in arc
// (the same near/far split validation uses); level below 24 m, full bank
// beyond 40 m. relaxTwoTier floors (20/34 m) put every hairpin bay under it.
const PROX_ARC_GAP = 60;
const PROX_MASK_LO = 24;
const PROX_MASK_HI = 40;
// Start zone level in t [0.92, 1) u [0, 0.045] — strictly contains the width
// START_ZONE [0.93, 0.03] — with a 20 m ramp outside it.
const START_ZONE_FROM = 0.92;
const START_ZONE_TO = 0.045;
const ZONE_RAMP = 20;
// Level within +-30 m of a branch anchor (> RIDGE_BLEND = 24), 20 m ramp.
const JUNCTION_CLEAR = 30;
const JUNCTION_RAMP = 20;

/**
 * Signed per-station bank profile (rad, + = left side of travel raised) for
 * a closed loop. Deterministic in (input, branches, bankMax); zero-safe:
 * bankMax <= 0 yields an all-zero profile.
 */
export function generateBankProfile(
  input: BankGenInput,
  branches: ReadonlyArray<Pick<BranchSpec, "tA" | "tB">>,
  bankMax: number,
): BankProfile {
  const { x, z, ds, kappa, length } = input;
  const n = kappa.length;
  const count = Math.max(8, Math.round(length / BANK_STATION_STEP));
  const step = length / count;
  const s = new Array<number>(count);
  for (let i = 0; i < count; i++) s[i] = i * step;
  const bank = new Array<number>(count).fill(0);
  if (bankMax <= 0 || n === 0) return { s, bank };

  // Smoothed signed curvature -> raw bank per sample (inside of corner low).
  const win = Math.max(1, Math.round(CURV_SMOOTH_HALF / ds));
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -win; j <= win; j++) acc += kappa[(i + j + n) % n]!;
    const ks = acc / (2 * win + 1);
    raw[i] =
      -Math.sign(ks) *
      bankMax *
      smoothstep(1 / BANK_ONSET_RADIUS, 1 / BANK_FULL_RADIUS, Math.abs(ks));
  }

  // Proximity mask over the sample ring.
  const index = new SampleIndex(x, z, 16);
  const prox = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let minDist = Infinity;
    index.forEachWithin(x[i]!, z[i]!, PROX_MASK_HI, (j, dSq) => {
      const rawGap = Math.abs(j - i) * ds;
      const gap = Math.min(rawGap, length - rawGap);
      if (gap <= PROX_ARC_GAP) return;
      const d = Math.sqrt(dSq);
      if (d < minDist) minDist = d;
    });
    prox[i] = smoothstep(PROX_MASK_LO, PROX_MASK_HI, minDist);
  }

  for (let i = 0; i < count; i++) {
    const at = Math.round(s[i]! / ds) % n;
    const t = s[i]! / length;
    let m = prox[at]! * zoneMask(t, length);
    for (const b of branches) {
      m *= anchorMask(t, b.tA, length) * anchorMask(t, b.tB, length);
    }
    const v = raw[at]! * m;
    bank[i] = v === 0 ? 0 : v; // normalize -0 from a zeroed mask
  }

  relaxBankSlope(bank, step);
  return { s, bank };
}

/** 0 inside the start zone, ramping to 1 over ZONE_RAMP metres outside. */
function zoneMask(t: number, length: number): number {
  const w = wrapT(t);
  if (w >= START_ZONE_FROM || w <= START_ZONE_TO) return 0;
  const distM = Math.min(arcDistT(w, START_ZONE_FROM), arcDistT(w, START_ZONE_TO)) * length;
  return smoothstep(0, ZONE_RAMP, distM);
}

/** 0 within JUNCTION_CLEAR metres of a branch anchor, ramped beyond. */
function anchorMask(t: number, anchor: number, length: number): number {
  const distM = arcDistT(wrapT(t), wrapT(anchor)) * length;
  return smoothstep(JUNCTION_CLEAR, JUNCTION_CLEAR + JUNCTION_RAMP, distM);
}

/**
 * Cap |d bank / d s| at BANK_SLOPE_MAX by shrinking the larger-magnitude
 * side of each violating pair toward zero. Never grows a magnitude, so
 * masked zeros stay exactly zero; bounded passes converge in practice and
 * the cap is test-asserted.
 */
function relaxBankSlope(bank: number[], step: number): void {
  const nS = bank.length;
  const cap = BANK_SLOPE_MAX * step;
  for (let pass = 0; pass < nS; pass++) {
    let changed = false;
    for (let i = 0; i < nS; i++) {
      const j = (i + 1) % nS;
      const d = bank[j]! - bank[i]!;
      if (Math.abs(d) <= cap) continue;
      if (Math.abs(bank[i]!) >= Math.abs(bank[j]!)) {
        bank[i] = bank[j]! - Math.sign(d) * cap;
      } else {
        bank[j] = bank[i]! + Math.sign(d) * cap;
      }
      changed = true;
    }
    if (!changed) return;
  }
}

/** Wrapped |a - b| distance between two loop params in [0, 0.5]. */
function arcDistT(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function wrapT(t: number): number {
  const w = t % 1;
  return w < 0 ? w + 1 : w;
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
