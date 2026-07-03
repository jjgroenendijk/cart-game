/**
 * Pure drift skid-mark ring-buffer math (053 commit 3). No THREE, Rapier,
 * WebGL, or DOM: jsdom-testable corner/append/fade math the GL owner
 * (SkidMarksLayer.ts) consumes. Mirrors kartVfx.ts RingCursor pattern. The
 * GL owner bakes terrain-conformed Y at append time, so this module leaves
 * the corner Y components at 0 and only computes the XZ quad corners.
 */

/** One ring segment = a quad (prev-L, prev-R, curr-L, curr-R). */
export interface SkidSegment {
  birth: number; // uTime at append (set by the GL owner)
  // prev-left, prev-right, curr-left, curr-right (XYZ; Y left 0 here)
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  dx: number;
  dy: number;
  dz: number;
}

/** Per-tier segment capacity (low/med/high). */
export const SKID_SEGMENTS: Record<"low" | "med" | "high", number> = {
  low: 256,
  med: 512,
  high: 1024,
};

/** Half-width of one tire track in world units (thin dark line). */
export const SKID_HALF_WIDTH = 0.12;
/** Min travel distance between segment appends (avoids dense overlap). */
export const SKID_MIN_STEP = 0.15;
/** Linear fade duration in seconds (~6 s per the look target). */
export const SKID_FADE_TIME = 6.0;

/** Append rule: drifting + rear wheel grounded + moved > minStep. Pure. */
export function shouldAppendSkid(
  isDrifting: boolean,
  rearGrounded: boolean,
  movedDist: number,
  minStep: number,
): boolean {
  return isDrifting && rearGrounded && movedDist > minStep;
}

/** Compute a segment's 4 corners from prev/curr wheel center pos + a right
 *  vector (unit perpendicular to travel dir in XZ) + halfWidth. Mutates
 *  `out` XZ; sets Y to 0 (GL owner bakes terrain height). Pure. */
export function segmentCorners(
  prevX: number,
  prevZ: number,
  currX: number,
  currZ: number,
  rightX: number,
  rightZ: number,
  halfWidth: number,
  out: SkidSegment,
): SkidSegment {
  const lx = rightX * halfWidth;
  const lz = rightZ * halfWidth;
  out.ax = prevX + lx;
  out.ay = 0;
  out.az = prevZ + lz; // prev-left
  out.bx = prevX - lx;
  out.by = 0;
  out.bz = prevZ - lz; // prev-right
  out.cx = currX + lx;
  out.cy = 0;
  out.cz = currZ + lz; // curr-left
  out.dx = currX - lx;
  out.dy = 0;
  out.dz = currZ - lz; // curr-right
  return out;
}

/** Linear fade: 1 at birth, 0 at fadeTime, clamped. Negative age -> 1. */
export function skidFade(age: number, fadeTime: number): number {
  if (age <= 0) return 1;
  const f = 1 - age / fadeTime;
  if (f <= 0) return 0;
  return f >= 1 ? 1 : f;
}

/** Ring cursor for segments (mirrors kartVfx.ts RingCursor). */
export interface SkidRingCursor {
  capacity: number;
  head: number;
  count: number;
}

export function makeSkidRing(capacity: number): SkidRingCursor {
  const cap = Math.max(1, Math.floor(capacity));
  return { capacity: cap, head: 0, count: 0 };
}

/** Push one segment slot: returns the index written; wraps + overwrites the
 *  oldest once full. head advances (mod capacity); count caps at capacity. */
export function skidRingPush(cur: SkidRingCursor): number {
  const idx = cur.head;
  cur.head = (cur.head + 1) % cur.capacity;
  if (cur.count < cur.capacity) cur.count += 1;
  return idx;
}
