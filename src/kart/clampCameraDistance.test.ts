import { describe, expect, it } from "vitest";
import { clampCameraDistance, DEFAULT_CAMERA_CLAMP, type RayHit } from "./clampCameraDistance";

describe("clampCameraDistance (147)", () => {
  const origin = { x: 0, y: 0, z: 0 };
  const dir = { x: 1, y: 0, z: 0 };
  const out = { x: 0, y: 0, z: 0 };

  it("returns the unobstructed desired position when there is no hit", () => {
    const r = clampCameraDistance(origin, dir, 8, null, { ...out });
    expect(r.x).toBeCloseTo(8, 6);
    expect(r.y).toBe(0);
    expect(r.z).toBe(0);
  });

  it("returns the desired position when the hit is at/ beyond the desired distance", () => {
    const hit: RayHit = { toi: 10, normal: { x: -1, y: 0, z: 0 } };
    const r = clampCameraDistance(origin, dir, 8, hit, { ...out });
    expect(r.x).toBeCloseTo(8, 6);
  });

  it("clamps to toi - skin along the ray on an obstruction", () => {
    const { skin } = DEFAULT_CAMERA_CLAMP; // 0.3
    const hit: RayHit = { toi: 4, normal: { x: -1, y: 0, z: 0 } };
    const r = clampCameraDistance(origin, dir, 8, hit, { ...out });
    expect(r.x).toBeCloseTo(4 - skin, 6);
  });

  it("respects the minDist floor on a false near-zero toi", () => {
    const hit: RayHit = { toi: 0.5, normal: { x: -1, y: 0, z: 0 } };
    const r = clampCameraDistance(origin, dir, 8, hit, { ...out });
    expect(r.x).toBeCloseTo(DEFAULT_CAMERA_CLAMP.minDist, 6);
  });

  it("never clamps the camera further than the desired distance", () => {
    const hit: RayHit = { toi: 12, normal: { x: -1, y: 0, z: 0 } };
    const r = clampCameraDistance(origin, dir, 8, hit, { ...out });
    expect(r.x).toBeCloseTo(8, 6);
  });

  it("mutates and returns the out vector (zero-alloc reuse)", () => {
    const sink = { x: -9, y: -9, z: -9 };
    const r = clampCameraDistance(origin, dir, 6, null, sink);
    expect(r).toBe(sink);
    expect(r.x).toBeCloseTo(6, 6);
  });

  it("writes origin + dir*dist in 3D, not just X", () => {
    const o = { x: 10, y: 5, z: -3 };
    const d = { x: 0, y: 1, z: 0 };
    const r = clampCameraDistance(o, d, 7, null, { ...out });
    expect(r.x).toBeCloseTo(10, 6);
    expect(r.y).toBeCloseTo(12, 6);
    expect(r.z).toBeCloseTo(-3, 6);
  });
});
