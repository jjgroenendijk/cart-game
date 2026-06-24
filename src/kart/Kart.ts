import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { KartController, DEFAULT_TUNING, type KartTuning } from "./KartController";
import type { KartInput } from "../core/Input";
import { makeCel } from "../materials/cel";
import { addOutline } from "../materials/outline";
import { applyKartLodGroup, type KartLodResult } from "./kartLod";

// Screen-space inverted-hull thickness (NDC units; ~thickness * screenWidth/2
// pixels). Kart reads mid-screen, so a few px reads as a crisp toon rim.
const BODY_OUTLINE = 0.005;
const DETAIL_OUTLINE = 0.004;

export interface KartColors {
  body: number;
  accent: number;
}

const PALETTE: KartColors[] = [
  { body: 0xff5252, accent: 0xffd23f },
  { body: 0x4fc3f7, accent: 0xffffff },
  { body: 0x66bb6a, accent: 0x222222 },
  { body: 0xab47bc, accent: 0xffd23f },
];

interface WheelRig {
  steer: THREE.Object3D;
  spin: THREE.Object3D;
  front: boolean;
}

export class Kart {
  readonly group = new THREE.Group();
  readonly controller: KartController;
  private readonly wheels: WheelRig[] = [];
  private readonly forward = new THREE.Vector3(0, 0, -1);
  readonly speedVec = new THREE.Vector3();

  constructor(
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    spawnYaw: number,
    playerIndex = 0,
    tuning: KartTuning = DEFAULT_TUNING,
  ) {
    this.controller = new KartController(physics, spawn, spawnYaw, tuning);
    const colors = PALETTE[playerIndex % PALETTE.length];
    this.buildMesh(colors);
    this.group.userData.role = "kart";
  }

  private buildMesh(colors: KartColors): void {
    const bodyMat = makeCel({ color: colors.body });
    const accentMat = makeCel({ color: colors.accent });
    const darkMat = makeCel({ color: 0x1a1a1f });

    // Main chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 1.9), bodyMat);
    chassis.position.y = -0.05;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    addOutline(chassis, BODY_OUTLINE);
    this.group.add(chassis);

    // Nose wedge (front)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.5), bodyMat);
    nose.position.set(0, -0.1, -1.0);
    nose.castShadow = true;
    addOutline(nose, BODY_OUTLINE);
    this.group.add(nose);

    // Seat / driver blob
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), darkMat);
    seat.position.set(0, 0.25, 0.15);
    seat.castShadow = true;
    addOutline(seat, DETAIL_OUTLINE);
    this.group.add(seat);

    const driver = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), accentMat);
    driver.position.set(0, 0.55, 0.15);
    driver.castShadow = true;
    addOutline(driver, DETAIL_OUTLINE);
    this.group.add(driver);

    // Rear spoiler
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.3), accentMat);
    spoiler.position.set(0, 0.2, 0.95);
    spoiler.castShadow = true;
    addOutline(spoiler, DETAIL_OUTLINE);
    this.group.add(spoiler);
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.2), darkMat);
    wingL.position.set(-0.45, 0.1, 0.95);
    wingL.userData.kartDetail = true;
    this.group.add(wingL);
    const wingR = wingL.clone();
    wingR.position.x = 0.45;
    wingR.userData.kartDetail = true;
    this.group.add(wingR);

    // Wheels
    const offsets = [
      { x: -0.62, z: -0.78, front: true },
      { x: 0.62, z: -0.78, front: true },
      { x: -0.62, z: 0.82, front: false },
      { x: 0.62, z: 0.82, front: false },
    ];
    for (const off of offsets) {
      const rig = this.buildWheel(darkMat, accentMat);
      rig.steer.position.set(off.x, -0.35, off.z);
      rig.front = off.front;
      this.group.add(rig.steer);
      this.wheels.push(rig);
    }
  }

  private buildWheel(tireMat: THREE.Material, hubMat: THREE.Material): WheelRig {
    const steer = new THREE.Object3D();
    const spin = new THREE.Object3D();
    steer.add(spin);

    // Default cylinder axle is Y; rotate z=PI/2 to lay axle along X (left-right).
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 18), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    addOutline(tire, DETAIL_OUTLINE);
    spin.add(tire);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 12), hubMat);
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);

    // Spokes radiate in the wheel plane (Y-Z), thin along the axle (X).
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.56, 0.07), hubMat);
      spoke.rotation.x = (i / 4) * Math.PI * 2;
      spoke.userData.kartDetail = true;
      spin.add(spoke);
    }

    return { steer, spin, front: true };
  }

  fixedUpdate(dt: number, input: KartInput): void {
    this.controller.fixedUpdate(dt, input);
  }

  /** Copy physics transform to visuals. Call once per render frame. */
  sync(frameAlpha: number): void {
    const body = this.controller.body;
    const t = body.translation();
    this.group.position.set(t.x, t.y, t.z);
    const r = body.rotation();
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    this.forward.set(0, 0, -1).applyQuaternion(this.group.quaternion);

    const states = this.controller.wheels;
    for (let i = 0; i < this.wheels.length; i++) {
      const rig = this.wheels[i];
      const s = states[i];
      if (rig.front) rig.steer.rotation.y = s.steerAngle;
      rig.spin.rotation.x = s.spin;
      rig.steer.position.y = -0.35 + s.compression * 0.5;
    }

    const lv = body.linvel();
    this.speedVec.set(lv.x, lv.y, lv.z);
    void frameAlpha;
  }

  /** Apply a resolved LOD result to this kart's group (shadow + detail flags). */
  applyLod(res: KartLodResult): void {
    applyKartLodGroup(this.group, res);
  }

  get forwardDir(): THREE.Vector3 {
    return this.forward;
  }

  get speed(): number {
    return this.speedVec.dot(this.forward);
  }
}
