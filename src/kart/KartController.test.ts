import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { KartController } from "./KartController";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
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
});
