/**
 * Per-station scalar profiles along a track edge: the piecewise-linear
 * sampler shared by the width profile (059) and the bank profile (084).
 * Extracted from trackGraph.ts; jsdom-safe, THREE-free.
 */

/**
 * Single source of the drivable corridor half-width baseline (m). Every
 * corridor consumer reads width from a GraphPose/FieldPose; this constant only
 * seeds constant-width edges (tests, legacy defaults) and the terrain config.
 */
export const DEFAULT_TRACK_HALF_WIDTH = 6;

/**
 * Piecewise-linear half-width along an edge: `s` (m, ascending, s[0] = 0) ->
 * `halfWidth` (m). Closed edges wrap the final segment back to s[0]+length.
 */
export interface WidthProfile {
  s: ReadonlyArray<number>;
  halfWidth: ReadonlyArray<number>;
}

/**
 * Piecewise-linear signed bank angle along an edge: `s` (m, ascending,
 * s[0] = 0) -> `bank` (rad, + = left side of travel raised). Same station
 * conventions as WidthProfile.
 */
export interface BankProfile {
  s: ReadonlyArray<number>;
  bank: ReadonlyArray<number>;
}

/**
 * Evaluate a piecewise-linear station profile at arc position s (m) on an
 * edge of `length` m. Closed edges wrap s; open edges clamp to the end
 * stations. Empty profiles return `fallback`.
 */
export function profileAt(
  stations: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  s: number,
  length: number,
  closed = true,
  fallback = 0,
): number {
  const n = stations.length;
  if (n === 0) return fallback;
  if (n === 1) return values[0]!;
  if (!closed) {
    if (s <= stations[0]!) return values[0]!;
    if (s >= stations[n - 1]!) return values[n - 1]!;
  }
  const sw = ((s % length) + length) % length;
  // Binary search for the last station with station.s <= sw.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (stations[mid]! <= sw) lo = mid;
    else hi = mid - 1;
  }
  const i0 = lo;
  const i1 = (lo + 1) % n;
  const s0 = stations[i0]!;
  const s1 = i1 === 0 ? length : stations[i1]!;
  const span = s1 - s0;
  const f = span > 1e-9 ? (sw - s0) / span : 0;
  return values[i0]! + (values[i1]! - values[i0]!) * f;
}

/**
 * Evaluate a WidthProfile at arc position s (m) on an edge of `length` m.
 * Closed edges wrap s; open edges clamp to the end stations.
 */
export function widthProfileAt(
  profile: WidthProfile,
  s: number,
  length: number,
  closed = true,
): number {
  return profileAt(profile.s, profile.halfWidth, s, length, closed, DEFAULT_TRACK_HALF_WIDTH);
}

/**
 * Bake a per-station table by sampling a profile (or filling a constant /
 * fallback) at each station arc position.
 */
export function buildStationTable(
  count: number,
  sAt: (i: number) => number,
  length: number,
  source: number | { s: ReadonlyArray<number>; v: ReadonlyArray<number> } | undefined,
  fallback: number,
  closed = true,
): Float32Array {
  const out = new Float32Array(count);
  if (typeof source === "number" || source === undefined) {
    out.fill(source ?? fallback);
    return out;
  }
  for (let i = 0; i < count; i++) {
    out[i] = profileAt(source.s, source.v, sAt(i), length, closed, fallback);
  }
  return out;
}
