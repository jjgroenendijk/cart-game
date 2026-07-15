/**
 * Pure kart -> JSON serializer for the debug snapshot (whole-game state dump).
 *
 * Reads the AUTHORITATIVE Rapier body pose (translation/rotation/linvel/angvel)
 * off `kart.controller.body`, NOT the frame-interpolated `kart.group.position`
 * (that smears prev->cur between physics steps and would report a pose no
 * physics step ever held). Output is a plain, JSON-serializable object: every
 * vector/quat is copied field-by-field into a fresh literal so nothing aliases
 * a Rapier scratch buffer.
 *
 * Structural (KartLike) rather than importing the concrete Kart so jsdom specs
 * can feed a fake without constructing a real Rapier body (needs WASM/physics).
 * No WebGL, no THREE, no DOM: safe under jsdom/node.
 */

/** Rapier translation/linvel/angvel shape. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Rapier rotation (unit quaternion) shape. */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Per-wheel suspension state (mirrors KartController.WheelState). */
export interface WheelStateLike {
  grounded: boolean;
  compression: number;
  steerAngle: number;
  spin: number;
}

/** Minimal tuning fields KartController exposes that we summarize. */
export interface KartTuningLike {
  mass: number;
  maxSpeed: number;
  engineForce: number;
  brakeForce: number;
  grip: number;
  wheelRadius: number;
}

/** Authoritative body handle (subset of RAPIER.RigidBody we read). */
export interface KartBodyLike {
  translation(): Vec3Like;
  rotation(): QuatLike;
  linvel(): Vec3Like;
  angvel(): Vec3Like;
}

/** Structural view of KartController for serialization. */
export interface KartControllerLike {
  body: KartBodyLike;
  grounded: boolean;
  isDrifting: boolean;
  driftActive: boolean;
  life: number;
  inWater: boolean;
  wheels: readonly WheelStateLike[];
  tuning: KartTuningLike;
}

/** Structural view of Kart for serialization. */
export interface KartLike {
  speed: number;
  controller: KartControllerLike;
}

/** Summarized tuning block in the kart snapshot. */
export interface KartTuningSnapshot {
  mass: number;
  maxSpeed: number;
  engineForce: number;
  brakeForce: number;
  grip: number;
  wheelRadius: number;
}

/** JSON-serializable snapshot of one kart's authoritative physics state. */
export interface KartSnapshot {
  speed: number;
  grounded: boolean;
  drifting: boolean;
  life: number;
  inWater: boolean;
  pos: Vec3Like;
  rot: QuatLike;
  linvel: Vec3Like;
  angvel: Vec3Like;
  wheels: WheelStateLike[];
  tuning: KartTuningSnapshot;
}

/** Copy a Rapier vec into a fresh literal (no scratch aliasing). */
function copyVec3(v: Vec3Like): Vec3Like {
  return { x: v.x, y: v.y, z: v.z };
}

/** Copy a Rapier quat into a fresh literal (no scratch aliasing). */
function copyQuat(q: QuatLike): QuatLike {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/**
 * Serialize a kart to a plain JSON-serializable object. Pure: reads only, never
 * mutates the kart. Reads the live Rapier body (authoritative), not the visual
 * group. `drifting` prefers the `isDrifting` getter and falls back to
 * `driftActive` for fakes that only set the field.
 */
export function kartToJSON(kart: KartLike): KartSnapshot {
  const c = kart.controller;
  const body = c.body;
  const t = c.tuning;
  return {
    speed: kart.speed,
    grounded: c.grounded,
    drifting: c.isDrifting ?? c.driftActive ?? false,
    life: c.life,
    inWater: c.inWater,
    pos: copyVec3(body.translation()),
    rot: copyQuat(body.rotation()),
    linvel: copyVec3(body.linvel()),
    angvel: copyVec3(body.angvel()),
    wheels: c.wheels.map((w) => ({
      grounded: w.grounded,
      compression: w.compression,
      steerAngle: w.steerAngle,
      spin: w.spin,
    })),
    tuning: {
      mass: t.mass,
      maxSpeed: t.maxSpeed,
      engineForce: t.engineForce,
      brakeForce: t.brakeForce,
      grip: t.grip,
      wheelRadius: t.wheelRadius,
    },
  };
}
