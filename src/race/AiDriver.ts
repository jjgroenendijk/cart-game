/**
 * 007 AI driver. Pure function: given the kart's pose, ordered spline points
 * ahead, rival positions, a personality tuning, and an RNG, produce a KartInput
 * ({throttle, steer, drift, reset}). No Game/physics/three deps -> jsdom.
 *
 * Behaviour:
 * - Steering: pure-pursuit toward a speed-scaled lookahead point on the spline.
 *   Lookahead lerps near..far by speed01 so fast karts aim further ahead
 *   (dampens wobble).
 * - Throttle: braking-distance speed cap. allowedSpeed (aiSpeed.ts) caps the
 *   cruise speed per triple by Menger radius + brake budget; full throttle
 *   under the cap, proportional lift to zero above it. aggression +
 *   corridor halfWidth scale lateral accel (faster/narrower -> braker).
 * - Avoidance: rivals within avoidRadius add a lateral steer away.
 * - Stuck: slow + off-corridor for >= stuckTime requests a reset (Game respawns
 *   the kart at the nearest spline-ahead point).
 * - drift: always false (v1; AI drifting is a documented non-goal).
 *
 * Steering sign follows KartController: positive steer = turn left (+Y angvel).
 * produceInput sets steer so the nose turns toward the lookahead point.
 */

import type { KartInput } from "../core/Input";
import type { RNG } from "../core/rng";
import type { AiTuning } from "./aiTuning";
import { allowedSpeed } from "./aiSpeed";

const STEER_GAIN = 1.25;
const AVOID_GAIN = 0.6;
/** m/s band over which throttle eases full->0 above the allowed speed. */
const SPEED_EASE = 3;

export interface AiPose {
  pos: { x: number; z: number };
  /** Unit forward direction (XZ). */
  forward: { x: number; z: number };
  /** Forward speed (m/s). */
  speed: number;
  /** Horizontal distance from the spline centreline (m). */
  corridorDist: number;
  /** Corridor half-width at the kart (m); beyond it the kart is off-track. */
  corridorHalfWidth: number;
  /** Seconds spent slow + off-corridor (accumulated by Game). */
  stuckSeconds: number;
}

export interface AiSplinePoint {
  x: number;
  z: number;
  /** Corridor half-width at this sample (m); 056 plumbing for per-sample width. */
  halfWidth: number;
}

export interface AiRival {
  x: number;
  z: number;
}

/**
 * Produce one KartInput for an AI kart this step. Deterministic given the rng
 * sequence: same seed -> same input series.
 */
export function produceInput(
  pose: AiPose,
  ahead: readonly AiSplinePoint[],
  rivals: readonly AiRival[],
  tuning: AiTuning,
  rng: RNG,
): KartInput {
  // Stuck recovery takes priority: request a reset and otherwise idle.
  const stuck =
    pose.speed < tuning.stuckSpeed &&
    pose.corridorDist > pose.corridorHalfWidth &&
    pose.stuckSeconds >= tuning.stuckTime;
  if (stuck) {
    return { throttle: 0, steer: 0, drift: false, reset: true };
  }

  const speed01 = clamp01(pose.speed / tuning.refMaxSpeed);
  const lookahead = lerp(tuning.lookaheadNear, tuning.lookaheadFar, speed01);

  const target = lookaheadPoint(pose, ahead, lookahead);
  const steer = purePursuitSteer(pose, target) + avoidanceSteer(pose, rivals, tuning);
  const throttle = speedThrottle(pose.speed, ahead, tuning);

  // Tiny deterministic dither so the field does not lock to one rail.
  const dither = (rng.next() - 0.5) * 0.04;

  return {
    throttle: clamp01(throttle),
    steer: clamp(steer + dither, -1, 1),
    drift: false,
    reset: false,
  };
}

/** Walk the ahead samples until accumulated distance reaches the lookahead. */
function lookaheadPoint(
  pose: AiPose,
  ahead: readonly AiSplinePoint[],
  lookahead: number,
): AiSplinePoint {
  if (ahead.length === 0)
    return {
      x: pose.pos.x + pose.forward.x * lookahead,
      z: pose.pos.z + pose.forward.z * lookahead,
      halfWidth: pose.corridorHalfWidth,
    };
  let acc = 0;
  let prev = { x: pose.pos.x, z: pose.pos.z };
  for (const p of ahead) {
    acc += Math.hypot(p.x - prev.x, p.z - prev.z);
    if (acc >= lookahead) return p;
    prev = { x: p.x, z: p.z };
  }
  return ahead[ahead.length - 1]!;
}

/**
 * Pure-pursuit steer toward the target. right = forward x up (up = +Y) in XZ;
 * lateral = (target-pos) . right. Steer is -lateral-scaled so positive steer
 * (turn left) points the nose toward a target on the kart's left.
 */
function purePursuitSteer(pose: AiPose, target: AiSplinePoint): number {
  const fx = pose.forward.x;
  const fz = pose.forward.z;
  const dx = target.x - pose.pos.x;
  const dz = target.z - pose.pos.z;
  const rx = -fz;
  const rz = fx;
  const lateral = dx * rx + dz * rz;
  const fwd = Math.max(dx * fx + dz * fz, 0.5);
  const angle = Math.atan2(lateral, fwd); // >0 when target is to the right
  return clamp(-angle * STEER_GAIN, -1, 1);
}

/** Add a lateral steer away from rivals within avoidRadius. */
function avoidanceSteer(pose: AiPose, rivals: readonly AiRival[], tuning: AiTuning): number {
  if (rivals.length === 0 || tuning.avoidRadius <= 0) return 0;
  const fx = pose.forward.x;
  const fz = pose.forward.z;
  const rx = -fz;
  const rz = fx;
  let steer = 0;
  for (const r of rivals) {
    const relx = r.x - pose.pos.x;
    const relz = r.z - pose.pos.z;
    const dist = Math.hypot(relx, relz);
    if (dist >= tuning.avoidRadius || dist < 1e-3) continue;
    const strength = 1 - dist / tuning.avoidRadius;
    const lateral = (relx * rx + relz * rz) / dist; // rival's side, normalised
    // Rival on the right (lateral>0) -> steer left (positive) to move away.
    steer += strength * lateral * AVOID_GAIN;
  }
  return clamp(steer, -1, 1);
}

/**
 * Narrowest track half-width over the lookahead horizon (cautious limit).
 * Returns Infinity for an empty horizon: allowedSpeed returns Infinity for
 * ahead.length < 3 before touching halfWidth, and clamp01(Infinity/6)=1.
 */
function minHalfWidth(ahead: readonly AiSplinePoint[]): number {
  let m = Infinity;
  for (const p of ahead) if (p.halfWidth < m) m = p.halfWidth;
  return m;
}

/**
 * Throttle from the braking-distance speed model. Full throttle when the
 * current speed is at or under allowedSpeed (Infinity -> always full);
 * proportional lift to zero across the SPEED_EASE band above it. halfWidth
 * for the model is the min over the ahead horizon (narrowest point limits).
 */
function speedThrottle(speed: number, ahead: readonly AiSplinePoint[], tuning: AiTuning): number {
  const vAllow = allowedSpeed(ahead, tuning, minHalfWidth(ahead));
  if (speed <= vAllow) return 1; // vAllow=Infinity -> always full
  return clamp01(1 - (speed - vAllow) / SPEED_EASE);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
