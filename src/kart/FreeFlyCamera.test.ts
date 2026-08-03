// @vitest-environment jsdom
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { FreeFlyCamera } from "./FreeFlyCamera";
import { FREE_FLY_DEFAULTS } from "../core/freeFly";

/** Camera-local -Z rotated into world space: the current look direction. */
function look(cam: FreeFlyCamera): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
}

function keydown(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}
function keyup(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code }));
}
function mouseMove(movementX: number, movementY: number): void {
  document.dispatchEvent(new MouseEvent("mousemove", { movementX, movementY }));
}

let cam: FreeFlyCamera | null = null;
function make(): FreeFlyCamera {
  cam = new FreeFlyCamera(document.createElement("div"), { aspect: 16 / 9 });
  return cam;
}

afterEach(() => {
  cam?.dispose();
  cam = null;
});

describe("FreeFlyCamera — dev noclip wrapper", () => {
  it("defaults inactive and setActive/toggle flip it (idempotent)", () => {
    const fly = make();
    expect(fly.active).toBe(false);
    fly.setActive(true);
    expect(fly.active).toBe(true);
    fly.setActive(true); // idempotent
    expect(fly.active).toBe(true);
    fly.toggle();
    expect(fly.active).toBe(false);
  });

  it("KeyC on window toggles active", () => {
    const fly = make();
    keydown("KeyC");
    expect(fly.active).toBe(true);
    keydown("KeyC");
    expect(fly.active).toBe(false);
  });

  it("KeyW advances along the look direction; keyup stops it", () => {
    const fly = make();
    fly.setActive(true);
    const before = fly.camera.position.clone();
    const dir = look(fly).clone();
    keydown("KeyW");
    fly.update(0.5);
    const moved = fly.camera.position.clone().sub(before);
    expect(moved.length()).toBeGreaterThan(0);
    // Motion is parallel to (and same sense as) the look direction.
    expect(moved.clone().normalize().dot(dir)).toBeCloseTo(1, 5);

    keyup("KeyW");
    const held = fly.camera.position.clone();
    fly.update(0.5);
    expect(fly.camera.position.distanceTo(held)).toBe(0);
  });

  it("mouse moved right turns the look to the right (+X)", () => {
    const fly = make();
    fly.setActive(true);
    // Default look is straight ahead in XZ (yaw 0): no lateral component.
    expect(look(fly).x).toBeCloseTo(0, 6);
    mouseMove(120, 0);
    fly.update(0.016);
    // Mouse right -> yaw decreases -> look direction gains a +X (right) component.
    expect(look(fly).x).toBeGreaterThan(0);
  });

  it("mouse moved up pitches the look up (+Y)", () => {
    const fly = make();
    fly.setActive(true);
    const y0 = look(fly).y;
    mouseMove(0, -120); // movementY < 0 == moved up
    fly.update(0.016);
    expect(look(fly).y).toBeGreaterThan(y0);
  });

  it("pitch clamps and never flips over the top", () => {
    const fly = make();
    fly.setActive(true);
    for (let i = 0; i < 200; i++) {
      mouseMove(0, -100000); // relentless look-up
      fly.update(0.016);
    }
    const dir = look(fly);
    // At/below the +89deg clamp the look still points forward (z < 0); a flip
    // over the pole would swing z positive.
    expect(dir.z).toBeLessThan(0);
    expect(dir.y).toBeLessThanOrEqual(Math.sin(FREE_FLY_DEFAULTS.pitchLimit) + 1e-6);
    // And it actually reached the clamp.
    expect(dir.y).toBeGreaterThan(Math.sin(FREE_FLY_DEFAULTS.pitchLimit) - 1e-3);
  });

  it("dispose makes further key events inert", () => {
    const fly = make();
    fly.dispose();
    keydown("KeyC");
    expect(fly.active).toBe(false);
    // Movement keys also do nothing (listeners detached, wrapper inactive).
    keydown("KeyW");
    const pos = fly.camera.position.clone();
    fly.update(0.5);
    expect(fly.camera.position.distanceTo(pos)).toBe(0);
    cam = null; // already disposed
  });

  it("pose returns a copy of the current pose", () => {
    const fly = make();
    const pose = fly.pose;
    // Default INITIAL_STATE: position {0,30,40}, yaw 0, pitch -0.35.
    expect(pose.position).toEqual({ x: 0, y: 30, z: 40 });
    expect(pose.yaw).toBe(0);
    expect(pose.pitch).toBe(-0.35);
    // Mutating the returned position must not corrupt internal state.
    pose.position.x = 999;
    expect(fly.pose.position.x).toBe(0);
  });

  it("seedPose overwrites position + orientation and writes onto the camera", () => {
    const fly = make();
    fly.seedPose({ x: 5, y: 6, z: 7 }, Math.PI / 2, 0.1);
    expect(fly.camera.position).toEqual(new THREE.Vector3(5, 6, 7));
    expect(fly.pose.position).toEqual({ x: 5, y: 6, z: 7 });
    expect(fly.pose.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(fly.pose.pitch).toBeCloseTo(0.1, 6);
  });

  it("seedPose before setActive removes the entry jump (look matches seed)", () => {
    const fly = make();
    fly.seedPose({ x: 0, y: 0, z: 0 }, 0, 0);
    fly.setActive(true);
    // Yaw 0 / pitch 0 -> looking straight down -Z.
    const dir = look(fly);
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(-1, 6);
  });
});
