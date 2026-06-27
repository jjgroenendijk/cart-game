/**
 * 007 AI driver. Pure function: given the kart's pose, ordered spline points
 * ahead, rival positions, a personality tuning, and an RNG, produce a KartInput
 * ({throttle, steer, drift, reset}). No Game/physics/three deps -> jsdom.
 *
 * Behaviour:
 * - Steering: pure-pursuit toward a speed-scaled lookahead point on the spline.
 *   Lookahead lerps near..far by speed01 so fast karts aim further ahead
 *   (dampens wobble).
 * - Throttle: eases on upcoming curvature (3-point turn-angle estimate ahead),
 *   scaled by aggression (aggressive drivers brake later).
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

/** Corridor half-width (m); beyond it a kart is "off-track" for stuck logic. */
const CORRIDOR_HALF_WIDTH = 6;
const STEER_GAIN = 1.25;
const AVOID_GAIN = 0.6;
const EASE_MIN_THROTTLE = 0.45;
/** Turn angle (rad) counted as a sharp corner for throttle easing. */
const SHARP_TURN = 0.32;

export interface AiPose {
  pos: { x: number; z: number };
  /** Unit forward direction (XZ). */
  forward: { x: number; z: number };
  /** Forward speed (m/s). */
  speed: number;
  /** Horizontal distance from the spline centreline (m). */
  corridorDist: number;
  /** Seconds spent slow + off-corridor (accumulated by Game). */
  stuckSeconds: number;
}

export interface AiSplinePoint {
  x: number;
  z: number;
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
    pose.corridorDist > CORRIDOR_HALF_WIDTH &&
    pose.stuckSeconds >= tuning.stuckTime;
  if (stuck) {
    return { throttle: 0, steer: 0, drift: false, reset: true };
  }

  const speed01 = clamp01(pose.speed / tuning.refMaxSpeed);
  const lookahead = lerp(tuning.lookaheadNear, tuning.lookaheadFar, speed01);

  const target = lookaheadPoint(pose, ahead, lookahead);
  const steer = purePursuitSteer(pose, target) + avoidanceSteer(pose, rivals, tuning);
  const throttle = curvatureThrottle(ahead, tuning);

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
 * Throttle that eases on upcoming curvature. Estimates the turn angle between
 * two segments sampled ahead, maps it to a 0..1 curvature, and lifts off toward
 * EASE_MIN_THROTTLE. Aggression reduces the easing.
 */
function curvatureThrottle(ahead: readonly AiSplinePoint[], tuning: AiTuning): number {
  if (ahead.length < 3) return tuning.aggression;
  // Three points spanning a speed-scaled window ahead.
  const i0 = 0;
  const i1 = Math.min(ahead.length - 1, Math.floor(ahead.length * 0.33));
  const i2 = Math.min(ahead.length - 1, Math.floor(ahead.length * 0.66));
  const p0 = ahead[i0]!;
  const p1 = ahead[i1]!;
  const p2 = ahead[i2]!;
  const a1 = Math.atan2(p1.z - p0.z, p1.x - p0.x);
  const a2 = Math.atan2(p2.z - p1.z, p2.x - p1.x);
  let delta = Math.abs(angleDelta(a1, a2));
  delta /= Math.max(1, dist(p0, p1) / 4); // normalise by step size (~per 4 m)
  const curvature01 = clamp01(delta / SHARP_TURN);
  const eased = lerp(1, EASE_MIN_THROTTLE, curvature01);
  // Aggressive drivers resist the ease (brake later / less).
  const resist = clamp01((tuning.aggression - 0.7) / 0.3); // 0..1 across the band
  return clamp01(lerp(eased, 1, resist * 0.5));
}

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function dist(a: AiSplinePoint, b: AiSplinePoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
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
