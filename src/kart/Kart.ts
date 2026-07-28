import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { KartController, DEFAULT_TUNING, type KartTuning } from "./KartController";
import type { KartInput } from "../core/Input";
import { applyKartLodGroup, type KartLodResult } from "./kartLod";
import { variantById, type KartVariantId } from "./kartVariants";
import { wheelOffsetsFor, type WheelOffset } from "./models";
import { buildKartVisual, disposeKartVisual, type WheelRig } from "./kartVisual";

export interface KartColors {
  body: number;
  accent: number;
}

/**
 * Visual identity of a kart (083): which chassis model to build and what
 * colorway to paint it. Both default to the model's stock look, so
 * `new Kart(physics, spawn, yaw)` still reproduces the classic balanced kart.
 */
export interface KartStyle {
  model?: KartVariantId;
  colors?: KartColors;
}

export class Kart {
  readonly group = new THREE.Group();
  readonly controller: KartController;
  /** Local wheel stance for this model; feeds the rig + VFX contact points. */
  private readonly wheelOffsets: ReadonlyArray<WheelOffset>;
  private readonly wheels: WheelRig[];
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
    _playerIndex = 0,
    style: KartStyle = {},
    tuning: KartTuning = DEFAULT_TUNING,
    waterLevel: number | null = null,
  ) {
    this.controller = new KartController(physics, spawn, spawnYaw, tuning, waterLevel);
    const model = style.model ?? "balanced";
    const variant = variantById(model);
    this.wheelOffsets = wheelOffsetsFor(model);
    // Full visual (chassis + wheel rigs) comes from the shared builder so the
    // select-overlay preview shows exactly the mesh that races.
    this.wheels = buildKartVisual(this.group, model, style.colors ?? variant.colors);
    this.group.userData.role = "kart";
    // Prime the interpolation source so the first sync() (before any step)
    // renders the spawn pose instead of the (0,0,0) default.
    this.capturePrevPose();
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
   * Free GL resources (geometries, materials) via the shared
   * kartVisual disposer. The Rapier body is owned by FieldBuilder (it removes
   * it from the world). Idempotent.
   */
  dispose(): void {
    disposeKartVisual(this.group);
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
   * dust/drift-smoke/splash at the rear-wheel contact point. Offsets come
   * from this model's stance (kartModels), so VFX track the visible wheels.
   */
  wheelWorldPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    const o = this.wheelOffsets[i]!;
    return out.set(o.x, o.y, o.z).applyQuaternion(this.group.quaternion).add(this.group.position);
  }
}
