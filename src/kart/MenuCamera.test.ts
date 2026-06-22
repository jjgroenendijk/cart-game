import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MenuCamera } from "./MenuCamera";

const TOL = 1e-6;

describe("MenuCamera — cinematic orbit (006)", () => {
  it("position stays at `radius` from the target in XZ across updates", () => {
    const target = new THREE.Vector3(10, 2, -5);
    const cam = new MenuCamera({ aspect: 16 / 9, target, radius: 30 });
    for (let i = 0; i < 40; i++) cam.update(0.1);
    const p = cam.camera.position;
    const dxz = Math.hypot(p.x - target.x, p.z - target.z);
    expect(dxz).toBeCloseTo(30, 6);
    // Sample another moment.
    cam.update(2.3);
    const p2 = cam.camera.position;
    const dxz2 = Math.hypot(p2.x - target.x, p2.z - target.z);
    expect(dxz2).toBeCloseTo(30, 6);
  });

  it("altitude stays within [altitude - bobAmp, altitude + bobAmp]", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = new MenuCamera({
      aspect: 16 / 9,
      target,
      altitude: 18,
      bobAmp: 1.0,
      bobPeriod: 8,
    });
    for (let i = 0; i < 200; i++) {
      cam.update(0.05);
      const y = cam.camera.position.y;
      expect(y).toBeGreaterThanOrEqual(18 - 1.0 - TOL);
      expect(y).toBeLessThanOrEqual(18 + 1.0 + TOL);
    }
  });

  it("yaw advances at yawSpeed (a full sweep moves the angle)", () => {
    const cam = new MenuCamera({
      aspect: 16 / 9,
      target: new THREE.Vector3(),
      radius: 28,
      yawSpeed: 0.5,
    });
    const before = cam.camera.position.clone();
    cam.update(1.0); // yaw += 0.5 rad
    const after = cam.camera.position;
    expect(after.x).not.toBeCloseTo(before.x, 4);
    expect(after.z).not.toBeCloseTo(before.z, 4);
  });

  it("setAspect updates the camera projection aspect", () => {
    const cam = new MenuCamera({ aspect: 1 });
    expect(cam.camera.aspect).toBe(1);
    cam.setAspect(16 / 9);
    expect(cam.camera.aspect).toBeCloseTo(16 / 9, 6);
  });

  it("lookAt aims the camera at the target", () => {
    const target = new THREE.Vector3(5, 1, 5);
    const cam = new MenuCamera({ aspect: 16 / 9, target, radius: 20, altitude: 14 });
    cam.update(0.016);
    const dir = new THREE.Vector3();
    cam.camera.getWorldDirection(dir);
    const expected = new THREE.Vector3().subVectors(target, cam.camera.position).normalize();
    expect(dir.x).toBeCloseTo(expected.x, 5);
    expect(dir.y).toBeCloseTo(expected.y, 5);
    expect(dir.z).toBeCloseTo(expected.z, 5);
  });

  it("camera sees the solid, terrain, and sky layers", () => {
    const cam = new MenuCamera({ aspect: 16 / 9 });
    // Layer 0 is always enabled; 1 and 2 must be opted in.
    expect(cam.camera.layers.isEnabled(0)).toBe(true);
    expect(cam.camera.layers.isEnabled(1)).toBe(true);
    expect(cam.camera.layers.isEnabled(2)).toBe(true);
  });

  it("defaults: radius 28, altitude 18, fov 55", () => {
    const cam = new MenuCamera({ aspect: 16 / 9 });
    cam.update(0.016);
    const p = cam.camera.position;
    // target defaults to origin -> XZ distance == radius.
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(28, 6);
    expect(p.y).toBeCloseTo(18, 1); // bob at t=0.016 ~ 0
    expect(cam.camera.fov).toBe(55);
  });
});
