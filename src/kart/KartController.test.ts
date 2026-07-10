import { describe, expect, it, beforeAll, vi } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld, ActiveEvents } from "../physics/PhysicsWorld";
import {
  KartController,
  DEFAULT_TUNING,
  spawnClearance,
  uprightTargetFromNormals,
  MIN_GROUND_UP_Y,
} from "./KartController";
import { zeroInput } from "../core/Input";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

describe("spawnClearance", () => {
  // Ray origin sits 0.05 below body origin; rest length = rest + wheelRadius.
  const restPoseHeight = (t: typeof DEFAULT_TUNING) => 0.05 + t.suspensionRest + t.wheelRadius;

  it("default tuning clears the suspension rest pose (no step-1 launch)", () => {
    const c = spawnClearance(DEFAULT_TUNING);
    expect(c).toBeCloseTo(0.75, 5);
    expect(c).toBeGreaterThan(restPoseHeight(DEFAULT_TUNING));
  });

  it("scales with wheel radius so larger wheels spawn higher", () => {
    const base = spawnClearance(DEFAULT_TUNING);
    const bigWheels = { ...DEFAULT_TUNING, wheelRadius: 0.5 };
    expect(spawnClearance(bigWheels)).toBeCloseTo(base + (0.5 - DEFAULT_TUNING.wheelRadius), 5);
  });

  it("always clears the rest pose for varied suspension geometry", () => {
    const variants = [
      { ...DEFAULT_TUNING, suspensionRest: 0.2, wheelRadius: 0.3 },
      { ...DEFAULT_TUNING, suspensionRest: 0.4, wheelRadius: 0.45 },
      { ...DEFAULT_TUNING, suspensionRest: 0.5, wheelRadius: 0.6 },
    ];
    for (const v of variants) {
      expect(spawnClearance(v)).toBeGreaterThan(restPoseHeight(v));
    }
  });
});

describe("KartController.respawn", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("resets to the constructor spawn pose (not the flat-world 0,2,0 origin)", () => {
    const physics = new PhysicsWorld(-24);
    const spawn = new THREE.Vector3(3, 5, -2);
    const yaw = 0.7;
    const kc = new KartController(physics, spawn, yaw);

    // Throw the body somewhere else entirely.
    kc.body.setTranslation({ x: 42, y: 11, z: -17 }, true);
    kc.body.setRotation({ x: 0.2, y: 0.3, z: 0.4, w: 0.8 }, true);
    kc.body.setLinvel({ x: 9, y: 9, z: 9 }, true);

    kc.respawn();

    const t = kc.body.translation();
    expect(t.x).toBeCloseTo(spawn.x, 6);
    expect(t.y).toBeCloseTo(spawn.y, 6);
    expect(t.z).toBeCloseTo(spawn.z, 6);

    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const r = kc.body.rotation();
    expect(r.x).toBeCloseTo(expected.x, 6);
    expect(r.y).toBeCloseTo(expected.y, 6);
    expect(r.z).toBeCloseTo(expected.z, 6);
    expect(r.w).toBeCloseTo(expected.w, 6);

    const v = kc.body.linvel();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it("respawn is idempotent and stable across repeated calls", () => {
    const physics = new PhysicsWorld(-24);
    const spawn = new THREE.Vector3(-4, 2.5, 8);
    const kc = new KartController(physics, spawn, 1.2);
    kc.respawn();
    kc.respawn();
    const t = kc.body.translation();
    expect(t.x).toBeCloseTo(spawn.x, 6);
    expect(t.y).toBeCloseTo(spawn.y, 6);
    expect(t.z).toBeCloseTo(spawn.z, 6);
  });

  it("body collider is flagged for contact-force events (009)", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 2, 0), 0);
    expect(kc.collider.activeEvents()).toBe(ActiveEvents.CONTACT_FORCE_EVENTS);
    expect(typeof kc.collider.handle).toBe("number");
  });
});

describe("KartController buoyancy", () => {
  const dt = 1 / 60;

  it("buoyancy disabled by default (waterLevel null) - life stays 1", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 10, 0), 0);
    kc.fixedUpdate(dt, zeroInput());
    expect(kc.life).toBe(1);
    expect(kc.inWater).toBe(false);
  });

  it("below waterLevel: body pushed up + XZ damped", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 4, 0), 0, DEFAULT_TUNING, 5);
    const control = new KartController(
      physics,
      new THREE.Vector3(20, 4, 0),
      0,
      DEFAULT_TUNING,
      null,
    );
    kc.body.setLinvel({ x: 10, y: 0, z: 10 }, true);
    control.body.setLinvel({ x: 10, y: 0, z: 10 }, true);
    const initial = Math.hypot(10, 10);
    for (let i = 0; i < 3; i++) {
      kc.fixedUpdate(dt, zeroInput());
      control.fixedUpdate(dt, zeroInput());
      physics.step();
    }
    const lv = kc.body.linvel();
    const cv = control.body.linvel();
    expect(lv.y).toBeGreaterThan(cv.y);
    expect(Math.hypot(lv.x, lv.z)).toBeLessThan(initial);
  });

  it("life drains only when drainLife true", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 4, 0), 0, DEFAULT_TUNING, 5);
    for (let i = 0; i < 60; i++) kc.fixedUpdate(dt, zeroInput(), false);
    expect(kc.life).toBeCloseTo(1, 5);
    for (let i = 0; i < 60; i++) kc.fixedUpdate(dt, zeroInput(), true);
    expect(kc.life).toBeLessThan(0.95);
  });

  it("life recovers when out of water", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 4, 0), 0, DEFAULT_TUNING, 5);
    for (let i = 0; i < 30; i++) kc.fixedUpdate(dt, zeroInput(), true);
    expect(kc.life).toBeLessThan(1);
    kc.body.setTranslation({ x: 0, y: 6, z: 0 }, true);
    for (let i = 0; i < 60; i++) kc.fixedUpdate(dt, zeroInput(), true);
    expect(kc.life).toBeGreaterThan(0.99);
  });

  it("empty bar: life clamps to 0, no self-respawn", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 4, 0), 0, DEFAULT_TUNING, 5);
    kc.body.setTranslation({ x: 5, y: 4, z: 5 }, true);
    for (let i = 0; i < 600; i++) kc.fixedUpdate(dt, zeroInput(), true);
    expect(kc.life).toBe(0);
    const t = kc.body.translation();
    expect(t.x).toBeCloseTo(5, 6);
    expect(t.z).toBeCloseTo(5, 6);
  });

  it("reads drag/steer velocity after buoyancy; drag applied once (077.H)", () => {
    const physics = new PhysicsWorld(-24);
    const kc = new KartController(physics, new THREE.Vector3(0, 4, 0), 0, DEFAULT_TUNING, 5);
    kc.body.setLinvel({ x: 6, y: 0, z: 6 }, true);

    const seq: string[] = [];
    const origLinvel = kc.body.linvel.bind(kc.body);
    const origSetLinvel = kc.body.setLinvel.bind(kc.body);
    vi.spyOn(kc.body, "linvel").mockImplementation(() => {
      seq.push("linvel");
      return origLinvel();
    });
    vi.spyOn(kc.body, "setLinvel").mockImplementation((vel, wakeUp) => {
      seq.push("setLinvel");
      return origSetLinvel(vel, wakeUp);
    });

    kc.fixedUpdate(dt, zeroInput());

    const lastLinvel = seq.lastIndexOf("linvel");
    const lastSetLinvel = seq.lastIndexOf("setLinvel");
    expect(seq.filter((s) => s === "setLinvel")).toHaveLength(1);
    expect(lastSetLinvel).toBeGreaterThanOrEqual(0);
    expect(lastLinvel).toBeGreaterThan(lastSetLinvel);
  });
});

describe("uprightTargetFromNormals (084)", () => {
  const out = new THREE.Vector3();

  it("airborne (no grounded wheels) targets world up", () => {
    expect(uprightTargetFromNormals(new THREE.Vector3(9, 9, 9), 0, out)).toEqual(
      new THREE.Vector3(0, 1, 0),
    );
  });

  it("averages grounded contact normals to a unit vector", () => {
    const sum = new THREE.Vector3(0.2, 1, 0).add(new THREE.Vector3(-0.1, 1, 0.1));
    const t = uprightTargetFromNormals(sum, 2, out);
    expect(t.length()).toBeCloseTo(1, 6);
    expect(t.y).toBeGreaterThan(MIN_GROUND_UP_Y);
    expect(t.x).toBeCloseTo(0.1 / Math.sqrt(0.1 ** 2 + 2 ** 2 + 0.1 ** 2), 4);
  });

  it("cliff-steep normals (y below the clamp) fall back to world up", () => {
    const steep = new THREE.Vector3(1, 0.5, 0); // ~63 deg from vertical
    expect(uprightTargetFromNormals(steep, 1, out)).toEqual(new THREE.Vector3(0, 1, 0));
  });

  it("degenerate zero sum falls back to world up", () => {
    expect(uprightTargetFromNormals(new THREE.Vector3(0, 0, 0), 4, out)).toEqual(
      new THREE.Vector3(0, 1, 0),
    );
  });
});

describe("KartController upright follows the ground (084)", () => {
  it("settles level on flat ground (behavior-identical to world-up upright)", () => {
    const physics = new PhysicsWorld(-24);
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
    );
    const kc = new KartController(physics, new THREE.Vector3(0, 1, 0), 0);
    for (let i = 0; i < 120; i++) {
      kc.fixedUpdate(1 / 60, zeroInput());
      physics.step();
    }
    const q = kc.body.rotation();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    expect(kc.grounded).toBe(true);
    expect(up.y).toBeGreaterThan(0.999);
  });
});
