import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { KartController, DEFAULT_TUNING, type KartTuning } from "./KartController";
import type { KartInput } from "../core/Input";
import { makeCel } from "../materials/cel";
import { addOutline, removeOutline } from "../materials/outline";
import { applyKartLodGroup, type KartLodResult } from "./kartLod";
import type { KartSilhouette } from "./kartVariants";

// Screen-space inverted-hull thickness (NDC units; ~thickness * screenWidth/2
// pixels). Kart reads mid-screen, so a few px reads as a crisp toon rim.
const BODY_OUTLINE = 0.005;
const DETAIL_OUTLINE = 0.004;

export interface KartColors {
  body: number;
  accent: number;
}

// Stock mesh shape; matches the `balanced` variant spec in kartVariants so
// callers that pass no silhouette reproduce the original Kart look exactly.
const DEFAULT_SILHOUETTE: KartSilhouette = {
  bodyDims: [1.1, 0.4, 1.9],
  tireRadius: 0.35,
  noseZ: -1.0,
  spoilerH: 0.06,
};

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

/**
 * Local-space wheel rig offsets (matches {@link Kart.buildMesh}). Single source
 * of truth shared by the visual rig + {@link Kart.wheelWorldPos} (053 VFX) so
 * the emitted dust/smoke lands at the visible contact point. Order: front-L,
 * front-R, rear-L, rear-Z.
 */
export const WHEEL_LOCAL_OFFSETS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -0.62, y: -0.35, z: -0.78 },
  { x: 0.62, y: -0.35, z: -0.78 },
  { x: -0.62, y: -0.35, z: 0.82 },
  { x: 0.62, y: -0.35, z: 0.82 },
];

const FRONT_WHEELS = [true, true, false, false] as const;

export class Kart {
  readonly group = new THREE.Group();
  readonly controller: KartController;
  private readonly wheels: WheelRig[] = [];
  private readonly forward = new THREE.Vector3(0, 0, -1);
  readonly speedVec = new THREE.Vector3();
  // 022: prev physics pose + reusable cur-pose scratch for sync() lerp/slerp.
  // Allocated once; sync mutates them in place -> zero per-frame allocation.
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly curPos = new THREE.Vector3();
  private readonly curQuat = new THREE.Quaternion();

  constructor(
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    spawnYaw: number,
    playerIndex = 0,
    colors?: KartColors,
    silhouette: KartSilhouette = DEFAULT_SILHOUETTE,
    tuning: KartTuning = DEFAULT_TUNING,
    waterLevel: number | null = null,
  ) {
    this.controller = new KartController(physics, spawn, spawnYaw, tuning, waterLevel);
    const resolved = colors ?? PALETTE[playerIndex % PALETTE.length];
    this.buildMesh(resolved, silhouette);
    this.group.userData.role = "kart";
    // Prime the interpolation source so the first sync() (before any step)
    // renders the spawn pose instead of the (0,0,0) default.
    this.capturePrevPose();
  }

  private buildMesh(colors: KartColors, silhouette: KartSilhouette): void {
    const bodyMat = makeCel({ color: colors.body });
    const accentMat = makeCel({ color: colors.accent });
    const darkMat = makeCel({ color: 0x1a1a1f });

    // Main chassis
    const [bw, bh, bd] = silhouette.bodyDims;
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bodyMat);
    chassis.position.y = -0.05;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    addOutline(chassis, BODY_OUTLINE);
    this.group.add(chassis);

    // Nose wedge (front)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.5), bodyMat);
    nose.position.set(0, -0.1, silhouette.noseZ);
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

    // Rear spoiler (clamp height so BoxGeometry never sees <=0).
    const spoilerH = Math.max(silhouette.spoilerH, 0.02);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.1, spoilerH, 0.3), accentMat);
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
    for (let i = 0; i < WHEEL_LOCAL_OFFSETS.length; i++) {
      const off = WHEEL_LOCAL_OFFSETS[i]!;
      const rig = this.buildWheel(darkMat, accentMat, silhouette.tireRadius);
      rig.steer.position.set(off.x, off.y, off.z);
      rig.front = FRONT_WHEELS[i]!;
      this.group.add(rig.steer);
      this.wheels.push(rig);
    }
  }

  private buildWheel(
    tireMat: THREE.Material,
    hubMat: THREE.Material,
    tireRadius: number,
  ): WheelRig {
    const steer = new THREE.Object3D();
    const spin = new THREE.Object3D();
    steer.add(spin);

    // Default cylinder axle is Y; rotate z=PI/2 to lay axle along X (left-right).
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(tireRadius, tireRadius, 0.22, 18),
      tireMat,
    );
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    addOutline(tire, DETAIL_OUTLINE);
    spin.add(tire);

    const hubRadius = tireRadius * 0.4;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubRadius, hubRadius, 0.24, 12), hubMat);
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

  fixedUpdate(dt: number, input: KartInput, drainLife = false): void {
    this.controller.fixedUpdate(dt, input, drainLife);
    // A respawn teleport moves the body instantaneously; snap prev to the new
    // pose so the next sync() doesn't lerp across the teleport gap.
    if (this.controller.teleported) {
      this.controller.teleported = false;
      this.capturePrevPose();
    }
  }

  /**
   * Snapshot the live body pose as the interpolation source (prev). Call once
   * per kart BEFORE each fixed sub-step so sync() can lerp prev -> the
   * post-step body. Also call right after any teleport (respawn) so the visual
   * never smears across the teleport gap.
   */
  capturePrevPose(): void {
    const body = this.controller.body;
    const t = body.translation();
    this.prevPos.set(t.x, t.y, t.z);
    const r = body.rotation();
    this.prevQuat.set(r.x, r.y, r.z, r.w);
  }

  /**
   * Copy physics transform to visuals. Call once per render frame. `alpha` is
   * the sub-step fraction acc/STEP in [0,1]; sync lerps prev pose -> current
   * (live) body pose by alpha so a 60Hz physics pose paints in-between frames
   * on high-refresh displays instead of duplicating one pose 2+ times.
   * Reuses scratch fields: zero per-frame allocation.
   */
  sync(frameAlpha: number): void {
    const body = this.controller.body;
    const t = body.translation();
    this.curPos.set(t.x, t.y, t.z);
    const r = body.rotation();
    this.curQuat.set(r.x, r.y, r.z, r.w);
    this.group.position.copy(this.prevPos).lerp(this.curPos, frameAlpha);
    this.group.quaternion.copy(this.prevQuat).slerp(this.curQuat, frameAlpha);

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
  }

  /** Apply a resolved LOD result to this kart's group (shadow + detail flags). */
  applyLod(res: KartLodResult): void {
    applyKartLodGroup(this.group, res);
  }

  /**
   * Free GL resources: detach every inverted-hull outline (disposes its unique
   * InvertedHullMaterial) and dispose the unique geometries + materials across
   * the chassis/wheels. The Rapier body is owned by FieldBuilder (it removes
   * it from the world). Idempotent.
   */
  dispose(): void {
    const outlines: THREE.Mesh[] = [];
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.outlineHull) outlines.push(mesh);
    });
    for (const o of outlines) removeOutline(o);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.outlineHull) return;
      if (mesh.geometry) geos.add(mesh.geometry);
      const m = mesh.material;
      if (Array.isArray(m)) for (const mm of m) mats.add(mm);
      else if (m) mats.add(m);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }

  get forwardDir(): THREE.Vector3 {
    return this.forward;
  }

  get speed(): number {
    return this.speedVec.dot(this.forward);
  }

  /**
   * World position of wheel `i` from the current group pose. NOT
   * `getWorldPosition` (that needs a matrix-world update which may not have
   * run by the time VFX sample it). Kart action VFX (053) reads this to emit
   * dust/drift-smoke/splash at the rear-wheel contact point.
   */
  wheelWorldPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    const o = WHEEL_LOCAL_OFFSETS[i]!;
    return out.set(o.x, o.y, o.z).applyQuaternion(this.group.quaternion).add(this.group.position);
  }
}
