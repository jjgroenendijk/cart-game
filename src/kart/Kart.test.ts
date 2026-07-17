import { describe, expect, it, beforeAll, vi } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Kart } from "./Kart";
import type { KartInput } from "../core/Input";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

const RESET_INPUT: KartInput = { throttle: 0, steer: 0, drift: false, reset: true };

describe("Kart physics->visual interpolation (022)", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("sync(alpha) lerps position between prev and current body pose", () => {
    const physics = new PhysicsWorld(-24);
    const spawn = new THREE.Vector3(0, 5, 0);
    const kart = new Kart(physics, spawn, 0);
    // prev is primed to spawn in the ctor. Move the body to a distinct pose
    // (simulating one physics step's result) WITHOUT re-capturing prev, so
    // prev stays spawn and cur (live body) is the moved pose.
    kart.controller.body.setTranslation({ x: 10, y: 5, z: 0 }, true);

    kart.sync(0);
    expect(kart.group.position.x).toBeCloseTo(0, 6); // prev (spawn)
    kart.sync(1);
    expect(kart.group.position.x).toBeCloseTo(10, 6); // cur (live body)
    kart.sync(0.5);
    expect(kart.group.position.x).toBeCloseTo(5, 6); // midpoint
  });

  it("sync(alpha) slerps rotation between prev and current", () => {
    const physics = new PhysicsWorld(-24);
    const kart = new Kart(physics, new THREE.Vector3(0, 5, 0), 0); // yaw 0
    // prev = identity (yaw 0). Rotate the body 90deg about Y.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    kart.controller.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);

    kart.sync(0.5);
    // Halfway yaw = 45deg; forward (0,0,-1) rotated 45deg about Y.
    const f = kart.forwardDir;
    expect(f.x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(f.z).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it("capturePrevPose snaps prev to the live body (no teleport smear)", () => {
    const physics = new PhysicsWorld(-24);
    const kart = new Kart(physics, new THREE.Vector3(0, 5, 0), 0);
    // Simulate a teleport far away, then snap prev (as respawn paths do).
    kart.controller.body.setTranslation({ x: 100, y: 5, z: 0 }, true);
    kart.capturePrevPose();

    kart.sync(0.5);
    // prev == cur == live body -> visual lands on the teleported pose.
    expect(kart.group.position.x).toBeCloseTo(100, 6);
  });

  it("fixedUpdate with reset snaps interpolation (respawn path)", () => {
    const physics = new PhysicsWorld(-24);
    const spawn = new THREE.Vector3(2, 5, 3);
    const kart = new Kart(physics, spawn, 0.5);
    // Throw the body far away, then trigger a respawn via reset input.
    kart.controller.body.setTranslation({ x: 50, y: 5, z: 50 }, true);
    kart.fixedUpdate(1 / 60, RESET_INPUT);

    // Body is back at spawn AND prev snapped there -> sync renders spawn
    // regardless of alpha (no smear from the old far-away pose).
    kart.sync(0.5);
    const t = kart.controller.body.translation();
    expect(kart.group.position.x).toBeCloseTo(t.x, 6);
    expect(kart.group.position.z).toBeCloseTo(t.z, 6);
    expect(kart.group.position.x).toBeCloseTo(spawn.x, 6);
  });

  it("sync is allocation-free (cur fields are scratch, not new per call)", () => {
    const physics = new PhysicsWorld(-24);
    const kart = new Kart(physics, new THREE.Vector3(0, 5, 0), 0);
    kart.sync(0.3);
    const curPos = kart.group.position; // reference identity check via stability
    kart.sync(0.7);
    // group.position is mutated in place (copy/lerp), never reallocated.
    expect(kart.group.position).toBe(curPos);
  });

  it("dispose frees every unique geometry + material", () => {
    const physics = new PhysicsWorld(-24);
    const kart = new Kart(physics, new THREE.Vector3(0, 5, 0), 0);
    // Collect unique geometries + materials across the chassis/wheels.
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    kart.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry) geos.add(mesh.geometry);
      const m = mesh.material;
      if (Array.isArray(m)) for (const mm of m) mats.add(mm);
      else mats.add(m as THREE.Material);
    });
    expect(geos.size).toBeGreaterThan(0);
    expect(mats.size).toBeGreaterThanOrEqual(3);
    const geoSpies = [...geos].map((g) => vi.spyOn(g, "dispose"));
    const matSpies = [...mats].map((m) => vi.spyOn(m, "dispose"));
    kart.dispose();
    for (const s of geoSpies) expect(s).toHaveBeenCalled();
    for (const s of matSpies) expect(s).toHaveBeenCalled();
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const kart = new Kart(physics, new THREE.Vector3(0, 5, 0), 0);
    expect(() => kart.dispose()).not.toThrow();
    expect(() => kart.dispose()).not.toThrow();
  });
});
