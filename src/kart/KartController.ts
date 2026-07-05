import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { KartInput } from "../core/Input";
import { clamp } from "../core/math";
import { buoyancyForce, lifeDelta, clampLife } from "./buoyancy";

export interface KartTuning {
  mass: number;
  engineForce: number;
  brakeForce: number;
  maxSpeed: number;
  reverseSpeed: number;
  maxSteerRate: number;
  topSpeedSteerFactor: number;
  grip: number;
  driftGrip: number;
  driftBoost: number;
  coastDecel: number;
  suspensionStiffness: number;
  suspensionDamping: number;
  suspensionRest: number;
  suspensionTravel: number;
  wheelRadius: number;
  uprightTorque: number;
  uprightAngDamping: number;
}

export const DEFAULT_TUNING: KartTuning = {
  mass: 260,
  engineForce: 9000,
  brakeForce: 11000,
  maxSpeed: 34,
  reverseSpeed: 12,
  maxSteerRate: 2.6,
  topSpeedSteerFactor: 0.55,
  grip: 9.5,
  driftGrip: 1.6,
  driftBoost: 1.12,
  coastDecel: 4,
  suspensionStiffness: 42000,
  suspensionDamping: 3600,
  suspensionRest: 0.3,
  suspensionTravel: 0.25,
  wheelRadius: 0.35,
  uprightTorque: 28,
  uprightAngDamping: 4,
};

interface WheelDef {
  x: number;
  z: number;
  front: boolean;
}

const HALF_X = 0.55;
const HALF_Y = 0.25;
const HALF_Z = 0.95;
// Local Y of each suspension ray origin (below body origin).
const WHEEL_RAY_ORIGIN_Y = -0.05;
// Small settle buffer so the spring starts uncompressed and the kart
// drops gently instead of firing an impulse on the first step.
const SPAWN_SETTLE_BUFFER = 0.05;
const WHEELS: WheelDef[] = [
  { x: -HALF_X, z: -0.75, front: true },
  { x: HALF_X, z: -0.75, front: true },
  { x: -HALF_X, z: 0.75, front: false },
  { x: HALF_X, z: 0.75, front: false },
];

/**
 * Body-origin height above the terrain at which a kart should spawn so its
 * suspension starts at rest (uncompressed). Derived from the ray origin
 * offset + rest length (suspensionRest + wheelRadius) plus a small settle
 * buffer. Spawning below this value compresses the spring on step 1 and
 * launches the kart; spawning at/above lets it settle gently.
 */
export function spawnClearance(tuning: KartTuning): number {
  return -WHEEL_RAY_ORIGIN_Y + tuning.suspensionRest + tuning.wheelRadius + SPAWN_SETTLE_BUFFER;
}

export interface WheelState {
  grounded: boolean;
  compression: number;
  steerAngle: number;
  spin: number;
}

const forwardKey = new THREE.Vector3(0, 0, -1);
const rightKey = new THREE.Vector3(1, 0, 0);
const upKey = new THREE.Vector3(0, 1, 0);

export class KartController {
  readonly body: RAPIER.RigidBody;
  /** 009: the body collider handle, mapped to a kart index for impact SFX. */
  readonly collider: RAPIER.Collider;
  readonly tuning: KartTuning;
  private readonly physics: PhysicsWorld;
  private readonly maxRay: number;
  private readonly spawn: THREE.Vector3;
  private readonly spawnYaw: number;
  private readonly prevCompression = [0, 0, 0, 0];
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  // 022: reused scratch {x,y,z} refs handed to Rapier per step. Rapier copies
  // these immediately, so reuse across steps is safe; each call gets its own
  // field to avoid aliasing between values read in the same step.
  private readonly scratchSuspImpulse: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchWheelPoint: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchBuoyImpulse: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchBuoyPoint: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchBuoyLinvel: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchEngineImpulse: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchGripImpulse: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchSteerAngvel: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchUprightTorque: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  private readonly scratchUprightAngvel: RAPIER.Vector = { x: 0, y: 0, z: 0 };
  readonly wheels: WheelState[] = [
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
  ];
  grounded = false;
  driftActive = false;
  /** True for one step after a respawn teleport; Kart snaps interpolation. */
  teleported = false;
  private waterLevel: number | null = null;
  private lifeValue = 1;
  private inWaterState = false;

  constructor(
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    spawnYaw: number,
    tuning: KartTuning = DEFAULT_TUNING,
    waterLevel: number | null = null,
  ) {
    this.physics = physics;
    this.tuning = tuning;
    this.maxRay = tuning.suspensionRest + tuning.wheelRadius + tuning.suspensionTravel;
    this.spawn = spawn.clone();
    this.spawnYaw = spawnYaw;
    this.waterLevel = waterLevel;

    const bodyDesc = makeBodyDesc(spawn, spawnYaw, tuning);
    this.body = physics.world.createRigidBody(bodyDesc);
    this.collider = physics.world.createCollider(makeColliderDesc(tuning), this.body);
  }

  private basis(): void {
    const q = this.body.rotation();
    tmpQuat.set(q.x, q.y, q.z, q.w);
    this.forward.copy(forwardKey).applyQuaternion(tmpQuat);
    this.right.copy(rightKey).applyQuaternion(tmpQuat);
    this.up.copy(upKey).applyQuaternion(tmpQuat);
  }

  fixedUpdate(dt: number, input: KartInput, drainLife = false): void {
    const body = this.body;
    this.basis();

    const pos = body.translation();
    const chassisPos = tmpPos.set(pos.x, pos.y, pos.z);
    const q = body.rotation();
    tmpQuat.set(q.x, q.y, q.z, q.w);
    const lv = body.linvel();
    const vel = tmpVel.set(lv.x, lv.y, lv.z);

    const groundedWheels = this.updateSuspension(dt, body, chassisPos, tmpQuat);
    this.grounded = groundedWheels > 0;

    this.applyBuoyancy(dt, body, chassisPos, drainLife);

    const fwdSpeed = vel.dot(this.forward);
    const speedAbs = Math.abs(fwdSpeed);
    this.driftActive = input.drift && this.grounded && speedAbs > 7 && Math.abs(input.steer) > 0.15;

    if (this.grounded) {
      this.applyEngine(dt, body, input, fwdSpeed, speedAbs);
      this.applyGrip(dt, body, vel);
      this.applySteering(body, input, fwdSpeed);
    }

    this.applyUpright(dt, body);
    this.updateWheelVisuals(dt, input, fwdSpeed);

    if (input.reset) this.respawn();
  }

  private updateSuspension(
    dt: number,
    body: RAPIER.RigidBody,
    chassisPos: THREE.Vector3,
    quat: THREE.Quaternion,
  ): number {
    const t = this.tuning;
    let groundedCount = 0;
    const restLen = t.suspensionRest + t.wheelRadius;

    for (let i = 0; i < WHEELS.length; i++) {
      const w = WHEELS[i];
      const state = this.wheels[i];
      const world = tmpWheel
        .set(w.x, WHEEL_RAY_ORIGIN_Y, w.z)
        .applyQuaternion(quat)
        .add(chassisPos);

      const wp = this.scratchWheelPoint;
      wp.x = world.x;
      wp.y = world.y;
      wp.z = world.z;
      const hit = this.physics.castRayDown(wp, this.maxRay, body);

      let comp = 0;
      if (hit) {
        comp = clamp(restLen - hit.toi, -0.02, t.suspensionTravel + 0.02);
      }

      if (comp > 0) {
        const rate = (comp - this.prevCompression[i]) / dt;
        const force = Math.max(0, comp * t.suspensionStiffness + rate * t.suspensionDamping);
        const impulse = force * dt;
        const si = this.scratchSuspImpulse;
        si.x = 0;
        si.y = impulse;
        si.z = 0;
        body.applyImpulseAtPoint(si, wp, true);
        groundedCount++;
        state.grounded = true;
        state.compression = comp;
      } else {
        state.grounded = false;
        state.compression = 0;
      }
      this.prevCompression[i] = comp;
    }
    return groundedCount;
  }

  private applyBuoyancy(
    dt: number,
    body: RAPIER.RigidBody,
    chassisPos: THREE.Vector3,
    drainLife: boolean,
  ): void {
    if (this.waterLevel === null) return;
    const depth = this.waterLevel - chassisPos.y;
    this.inWaterState = depth > 0;
    const force = buoyancyForce(depth);
    if (force.up > 0) {
      const bi = this.scratchBuoyImpulse;
      bi.x = 0;
      bi.y = force.up;
      bi.z = 0;
      const bp = this.scratchBuoyPoint;
      bp.x = chassisPos.x;
      bp.y = chassisPos.y;
      bp.z = chassisPos.z;
      body.applyImpulseAtPoint(bi, bp, true);
    }
    if (depth > 0) {
      const lv = body.linvel();
      const lvOut = this.scratchBuoyLinvel;
      lvOut.x = lv.x * force.drag;
      lvOut.y = lv.y;
      lvOut.z = lv.z * force.drag;
      body.setLinvel(lvOut, true);
    }
    if (this.inWaterState) {
      this.lifeValue = clampLife(
        this.lifeValue + (drainLife ? lifeDelta(true, dt, this.lifeValue) : 0),
      );
    } else {
      this.lifeValue = clampLife(this.lifeValue + lifeDelta(false, dt, this.lifeValue));
    }
  }

  private applyEngine(
    dt: number,
    body: RAPIER.RigidBody,
    input: KartInput,
    fwdSpeed: number,
    speedAbs: number,
  ): void {
    const t = this.tuning;
    const boost = this.driftActive ? t.driftBoost : 1;

    if (input.throttle > 0) {
      if (fwdSpeed < t.maxSpeed * boost) {
        this.applyForwardImpulse(body, t.engineForce * input.throttle * dt);
      }
    } else if (input.throttle < 0) {
      if (fwdSpeed > 1.5) {
        // Brake: scalar is negative (throttle < 0) -> impulse opposes forward.
        this.applyForwardImpulse(body, t.brakeForce * input.throttle * dt);
      } else if (fwdSpeed > -t.reverseSpeed) {
        this.applyForwardImpulse(body, t.engineForce * 0.55 * input.throttle * dt);
      }
    } else if (speedAbs > 0.05) {
      const mag = Math.min(speedAbs, t.coastDecel * dt);
      const sign = fwdSpeed >= 0 ? -1 : 1;
      this.applyForwardImpulse(body, mag * sign);
    }
  }

  /** Write forward * scalar into the cached engine-impulse scratch and apply. */
  private applyForwardImpulse(body: RAPIER.RigidBody, s: number): void {
    const e = this.scratchEngineImpulse;
    e.x = this.forward.x * s;
    e.y = this.forward.y * s;
    e.z = this.forward.z * s;
    body.applyImpulse(e, true);
  }

  private applyGrip(dt: number, body: RAPIER.RigidBody, vel: THREE.Vector3): void {
    const t = this.tuning;
    const lateral = vel.dot(this.right);
    const factor = clamp((this.driftActive ? t.driftGrip : t.grip) * dt, 0, 1);
    const desiredChange = -lateral * factor;
    const m = desiredChange * t.mass;
    const g = this.scratchGripImpulse;
    g.x = this.right.x * m;
    g.y = 0;
    g.z = this.right.z * m;
    body.applyImpulse(g, true);
  }

  private applySteering(body: RAPIER.RigidBody, input: KartInput, fwdSpeed: number): void {
    const t = this.tuning;
    if (Math.abs(fwdSpeed) < 0.6 && !input.drift) return;
    const speedFactor = 1 - clamp(Math.abs(fwdSpeed) / t.maxSpeed, 0, 1) * t.topSpeedSteerFactor;
    let rate = input.steer * t.maxSteerRate * speedFactor;
    if (fwdSpeed < 0) rate = -rate;
    const av = body.angvel();
    const sa = this.scratchSteerAngvel;
    sa.x = av.x;
    sa.y = rate;
    sa.z = av.z;
    body.setAngvel(sa, true);
  }

  private applyUpright(dt: number, body: RAPIER.RigidBody): void {
    const t = this.tuning;
    const torqueAxis = tmpCross.copy(upKey).cross(this.up);
    const k = (this.grounded ? 0.35 : 1) * t.uprightTorque * dt;
    const ut = this.scratchUprightTorque;
    ut.x = torqueAxis.x * k;
    ut.y = 0;
    ut.z = torqueAxis.z * k;
    body.applyTorqueImpulse(ut, true);

    const av = body.angvel();
    const damp = 1 - clamp(t.uprightAngDamping * dt, 0, 1);
    const ua = this.scratchUprightAngvel;
    ua.x = av.x * damp;
    ua.y = av.y;
    ua.z = av.z * damp;
    body.setAngvel(ua, true);
  }

  private updateWheelVisuals(dt: number, input: KartInput, fwdSpeed: number): void {
    const t = this.tuning;
    const steerTarget = input.steer * 0.5;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.steerAngle = WHEELS[i].front ? lerp(w.steerAngle, steerTarget, 0.4) : 0;
      w.spin += (fwdSpeed / t.wheelRadius) * dt;
    }
  }

  respawn(): void {
    // Reset to the constructor spawn pose (terrain-aware) so R never dumps the
    // kart at a stale flat-world (0,2,0) origin.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spawnYaw);
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < this.prevCompression.length; i++) this.prevCompression[i] = 0;
    this.teleported = true;
    this.resetLife();
  }

  resetLife(): void {
    this.lifeValue = 1;
  }

  get isDrifting(): boolean {
    return this.driftActive;
  }

  get life(): number {
    return this.lifeValue;
  }

  get inWater(): boolean {
    return this.inWaterState;
  }
}

function makeBodyDesc(
  spawn: THREE.Vector3,
  yaw: number,
  _tuning: KartTuning,
): RAPIER.RigidBodyDesc {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawn.x, spawn.y, spawn.z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setLinearDamping(0.15)
    .setAngularDamping(0.6)
    .setCcdEnabled(true);
}

function makeColliderDesc(tuning: KartTuning): RAPIER.ColliderDesc {
  const volume = 2 * HALF_X * (2 * HALF_Y) * (2 * HALF_Z);
  const density = tuning.mass / volume;
  return RAPIER.ColliderDesc.cuboid(HALF_X, HALF_Y, HALF_Z)
    .setFriction(0.0)
    .setRestitution(0.0)
    .setDensity(density)
    .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const tmpWheel = new THREE.Vector3();
const tmpCross = new THREE.Vector3();
