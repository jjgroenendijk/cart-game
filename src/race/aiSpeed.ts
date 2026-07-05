/**
 * 056 braking-distance AI speed model. Pure: imports only types from
 * ./AiDriver (AiSplinePoint) and ./aiTuning (AiTuning); no three/core/
 * physics deps.
 *
 * allowedSpeed returns the max safe cruise speed (m/s) for the kart right
 * now given the path ahead. Infinity means no corner limit (straight / < 3
 * points). For each interior triple (a,b,c) it derives the Menger radius R,
 * corner speed sqrt(A_LAT*R), then lifts the candidate by the brake budget
 * available over the arc distance d from ahead[0] to b:
 *   candidate = sqrt(vCorner^2 + 2*A_BRAKE*d).
 * The running min over the horizon is the answer.
 *
 * One-step conservative bias: d is measured from ahead[0], which sits ~one
 * step ahead of the kart, so the model brakes ~one step early. That is
 * absorbed by the A_BRAKE tuning constant; the lap-time gate is a manual
 * in-game check (see commit message).
 */

import type { AiSplinePoint } from "./AiDriver";
import type { AiTuning } from "./aiTuning";
import { DEFAULT_TRACK_HALF_WIDTH } from "../terrain/trackGraph";

const A_LAT_BASE = 10; // m/s^2 baseline lateral accel
const A_BRAKE = 8; // m/s^2 braking decel budget
const MIN_CROSS = 1e-6; // straight-line guard (collinear triple)
// Width at which the lateral-accel budget is nominal; narrower -> cautious.
const REF_HALF_WIDTH = DEFAULT_TRACK_HALF_WIDTH;

/**
 * Max safe cruise speed (m/s) right now given the path ahead. Infinity when
 * the path is straight or has fewer than 3 points (no corner limit).
 */
export function allowedSpeed(
  ahead: readonly AiSplinePoint[],
  tuning: AiTuning,
  halfWidth: number,
): number {
  const aLat =
    A_LAT_BASE * (0.85 + 0.3 * tuning.aggression) * Math.sqrt(clamp01(halfWidth / REF_HALF_WIDTH));
  if (ahead.length < 3) return Infinity;

  let vAllow = Infinity;
  let d = 0;
  for (let i = 1; i < ahead.length - 1; i++) {
    const a = ahead[i - 1]!;
    const b = ahead[i]!;
    const c = ahead[i + 1]!;
    // Arc distance from ahead[0] to this triple's centre sample b, accumulated
    // BEFORE evaluating the triple.
    d += Math.hypot(b.x - a.x, b.z - a.z);

    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const bcx = c.x - b.x;
    const bcz = c.z - b.z;
    const cross = Math.abs(abx * bcz - abz * bcx);
    if (cross < MIN_CROSS) continue; // straight triple, no limit

    const ab = Math.hypot(abx, abz);
    const bc = Math.hypot(bcx, bcz);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const r = (ab * bc * ca) / (2 * cross); // Menger radius
    const vCorner = Math.sqrt(aLat * r);
    const candidate = Math.sqrt(vCorner * vCorner + 2 * A_BRAKE * d);
    if (candidate < vAllow) vAllow = candidate;
  }
  return vAllow;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
