import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { ChaseCamera } from "./ChaseCamera";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

describe("ChaseCamera spring-arm (147)", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("clamps the camera in front of a wall between kart and desired pose", () => {
    const physics = new PhysicsWorld(-24);
    // Wall slab between kart (origin) and where the camera wants to sit. Cuboid
    // half-extents (0.5,5,5) at (5,0,0) -> left face at x=4.5.
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 5, 5).setTranslation(5, 0, 0));
    physics.step(); // register collider in the broadphase before the cast
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0),
    );
    const cam = new ChaseCamera(1, physics, body);
    const kartPos = new THREE.Vector3(0, 0, 0);
    // forward (-1,0,0): back = -forward*dist -> camera desired at +X.
    const forward = new THREE.Vector3(-1, 0, 0);
    for (let i = 0; i < 60; i++) cam.update(1 / 60, kartPos, forward, 0, false);
    // Unclamped desiredPos.x is 7.5 (+height 3.2 -> ray dir tilts up, hit toi
    // ~4.89 on the wall face -> clamped dist ~4.59 -> x ~4.22). Cam must sit
    // in front of the wall (x<4.5) and well above the minDist floor (x>3).
    expect(cam.position.x).toBeLessThan(4.5);
    expect(cam.position.x).toBeGreaterThan(3);
    expect(cam.position.x).toBeCloseTo(4.22, 1);
  });

  it("does not clamp when the path to the desired pose is clear", () => {
    const physics = new PhysicsWorld(-24);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0),
    );
    const cam = new ChaseCamera(1, physics, body);
    const kartPos = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(-1, 0, 0);
    for (let i = 0; i < 60; i++) cam.update(1 / 60, kartPos, forward, 0, false);
    // No wall: first update snaps to the desired pose (7.5, 3.2, 0).
    expect(cam.position.x).toBeGreaterThan(6);
    expect(cam.position.x).toBeCloseTo(7.5, 1);
  });

  it("works without physics (menu/test path): no clamp, no throw", () => {
    const cam = new ChaseCamera(1);
    const kartPos = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(-1, 0, 0);
    expect(() => {
      for (let i = 0; i < 10; i++) cam.update(1 / 60, kartPos, forward, 0, false);
    }).not.toThrow();
    expect(cam.position.x).toBeGreaterThan(6);
  });
});
