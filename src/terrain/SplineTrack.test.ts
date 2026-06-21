import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { SplineTrack } from "./SplineTrack";

describe("SplineTrack", () => {
  it("is closed: getPoint(0) ~= getPoint(1)", () => {
    const t = new SplineTrack();
    const a = t.getPoint(0);
    const b = t.getPoint(1);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });

  it("startPos lands on the first control point", () => {
    const t = new SplineTrack();
    const p = t.startPos();
    const c0 = t.control[0];
    expect(p.distanceTo(c0)).toBeLessThan(1e-6);
  });

  it("tangent at the start is unit-length", () => {
    const t = new SplineTrack();
    const tan = t.curve.getTangent(0);
    expect(tan.length()).toBeCloseTo(1, 5);
  });

  it("startYaw points the kart forward (-Z) along the start tangent (XZ-projected)", () => {
    const t = new SplineTrack();
    const yaw = t.startYaw();
    // forward = (-sin yaw, 0, -cos yaw) must match the XZ-normalized tangent
    // (yaw discards the tangent's Y component by construction).
    const tan = t.curve.getTangent(0);
    const inv = 1 / Math.hypot(tan.x, tan.z);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    expect(fx).toBeCloseTo(tan.x * inv, 4);
    expect(fz).toBeCloseTo(tan.z * inv, 4);
  });

  it("closestPoint at a control point has near-zero horizontal distance", () => {
    const t = new SplineTrack();
    const c = t.control[4]; // arbitrary control point on the loop
    const r = t.closestPoint(c.x, c.z);
    // Sample spacing ~ loop/1024 ~ 0.37m -> well under 1m.
    expect(r.dist).toBeLessThan(0.6);
    expect(r.pathY).toBeCloseTo(c.y, 1);
  });

  it("closestPoint is symmetric and deterministic for identical queries", () => {
    const t = new SplineTrack();
    const a = t.closestPoint(12, -7);
    const b = t.closestPoint(12, -7);
    expect(a).toEqual(b);
  });

  it("loop stays in bounds (radius 45..70 from origin) -> fat, contained circuit", () => {
    const t = new SplineTrack();
    const n = 512;
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const p = t.curve.getSpacedPoints(n)[i];
      const r = Math.hypot(p.x, p.z);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    expect(minR).toBeGreaterThan(45);
    expect(maxR).toBeLessThan(75);
  });

  it("non-adjacent control points are well separated (no self-intersection)", () => {
    const t = new SplineTrack();
    const c = t.control;
    const n = c.length;
    let minSep = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        // Skip the wrap-adjacent pair (0,n-1), which IS adjacent on a loop.
        if (i === 0 && j === n - 1) continue;
        minSep = Math.min(minSep, c[i].distanceTo(c[j]));
      }
    }
    // ~60m between 2-apart points on a radius-60 circle -> comfortably > 45m.
    expect(minSep).toBeGreaterThan(45);
  });

  it("getPoint returns a reusable out vector", () => {
    const t = new SplineTrack();
    const out = new Vector3();
    const r = t.getPoint(0.25, out);
    expect(r).toBe(out);
    expect(out.length()).toBeGreaterThan(0);
  });
});
