import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { KartInput } from '../core/Input';
import { clamp } from '../core/math';

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
const WHEELS: WheelDef[] = [
  { x: -HALF_X, z: -0.75, front: true },
  { x: HALF_X, z: -0.75, front: true },
  { x: -HALF_X, z: 0.75, front: false },
  { x: HALF_X, z: 0.75, front: false },
];

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
  readonly tuning: KartTuning;
  private readonly physics: PhysicsWorld;
  private readonly maxRay: number;
  private readonly prevCompression = [0, 0, 0, 0];
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  readonly wheels: WheelState[] = [
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
    { grounded: false, compression: 0, steerAngle: 0, spin: 0 },
  ];
  grounded = false;
  driftActive = false;

  constructor(
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    spawnYaw: number,
    tuning: KartTuning = DEFAULT_TUNING,
  ) {
    this.physics = physics;
    this.tuning = tuning;
    this.maxRay = tuning.suspensionRest + tuning.wheelRadius + tuning.suspensionTravel;

    const bodyDesc = makeBodyDesc(spawn, spawnYaw, tuning);
    this.body = physics.world.createRigidBody(bodyDesc);
    physics.world.createCollider(makeColliderDesc(tuning), this.body);
  }

  private basis(): void {
    const q = this.body.rotation();
    tmpQuat.set(q.x, q.y, q.z, q.w);
    this.forward.copy(forwardKey).applyQuaternion(tmpQuat);
    this.right.copy(rightKey).applyQuaternion(tmpQuat);
    this.up.copy(upKey).applyQuaternion(tmpQuat);
  }

  fixedUpdate(dt: number, input: KartInput): void {
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

    const fwdSpeed = vel.dot(this.forward);
    const speedAbs = Math.abs(fwdSpeed);
    this.driftActive =
      input.drift && this.grounded && speedAbs > 7 && Math.abs(input.steer) > 0.15;

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
      const world = tmpWheel.set(w.x, -0.05, w.z).applyQuaternion(quat).add(chassisPos);

      const hit = this.physics.castRayDown(
        { x: world.x, y: world.y, z: world.z },
        this.maxRay,
        body,
      );

      let comp = 0;
      if (hit) {
        comp = clamp(restLen - hit.toi, -0.02, t.suspensionTravel + 0.02);
      }

      if (comp > 0) {
        const rate = (comp - this.prevCompression[i]) / dt;
        const force = Math.max(0, comp * t.suspensionStiffness + rate * t.suspensionDamping);
        const impulse = force * dt;
        body.applyImpulseAtPoint(
          { x: 0, y: impulse, z: 0 },
          { x: world.x, y: world.y, z: world.z },
          true,
        );
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
        const f = t.engineForce * input.throttle * dt;
        body.applyImpulse(vmul(this.forward, f), true);
      }
    } else if (input.throttle < 0) {
      if (fwdSpeed > 1.5) {
        const f = t.brakeForce * -input.throttle * dt;
        body.applyImpulse(vmul(this.forward.clone().negate(), f), true);
      } else if (fwdSpeed > -t.reverseSpeed) {
        const f = t.engineForce * 0.55 * input.throttle * dt;
        body.applyImpulse(vmul(this.forward, f), true);
      }
    } else if (speedAbs > 0.05) {
      const mag = Math.min(speedAbs, t.coastDecel * dt);
      const sign = fwdSpeed >= 0 ? -1 : 1;
      body.applyImpulse(vmul(this.forward, mag * sign), true);
    }
  }

  private applyGrip(dt: number, body: RAPIER.RigidBody, vel: THREE.Vector3): void {
    const t = this.tuning;
    const lateral = vel.dot(this.right);
    const factor = clamp((this.driftActive ? t.driftGrip : t.grip) * dt, 0, 1);
    const desiredChange = -lateral * factor;
    const m = desiredChange * t.mass;
    body.applyImpulse({ x: this.right.x * m, y: 0, z: this.right.z * m }, true);
  }

  private applySteering(body: RAPIER.RigidBody, input: KartInput, fwdSpeed: number): void {
    const t = this.tuning;
    if (Math.abs(fwdSpeed) < 0.6 && !input.drift) return;
    const speedFactor =
      1 - clamp(Math.abs(fwdSpeed) / t.maxSpeed, 0, 1) * t.topSpeedSteerFactor;
    let rate = input.steer * t.maxSteerRate * speedFactor;
    if (fwdSpeed < 0) rate = -rate;
    const av = body.angvel();
    body.setAngvel({ x: av.x, y: rate, z: av.z }, true);
  }

  private applyUpright(dt: number, body: RAPIER.RigidBody): void {
    const t = this.tuning;
    const torqueAxis = tmpCross.copy(upKey).cross(this.up);
    const k = (this.grounded ? 0.35 : 1) * t.uprightTorque * dt;
    body.applyTorqueImpulse({ x: torqueAxis.x * k, y: 0, z: torqueAxis.z * k }, true);

    const av = body.angvel();
    const damp = 1 - clamp(t.uprightAngDamping * dt, 0, 1);
    body.setAngvel({ x: av.x * damp, y: av.y, z: av.z * damp }, true);
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
    this.body.setTranslation({ x: 0, y: 2, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < this.prevCompression.length; i++) this.prevCompression[i] = 0;
  }

  get isDrifting(): boolean {
    return this.driftActive;
  }
}

function makeBodyDesc(spawn: THREE.Vector3, yaw: number, _tuning: KartTuning): RAPIER.RigidBodyDesc {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawn.x, spawn.y, spawn.z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setLinearDamping(0.15)
    .setAngularDamping(0.6)
    .setCcdEnabled(true);
}

function makeColliderDesc(tuning: KartTuning): RAPIER.ColliderDesc {
  const volume = (2 * HALF_X) * (2 * HALF_Y) * (2 * HALF_Z);
  const density = tuning.mass / volume;
  return RAPIER.ColliderDesc.cuboid(HALF_X, HALF_Y, HALF_Z)
    .setFriction(0.0)
    .setRestitution(0.0)
    .setDensity(density);
}

function vmul(v: THREE.Vector3, s: number): RAPIER.Vector {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const tmpWheel = new THREE.Vector3();
const tmpCross = new THREE.Vector3();
