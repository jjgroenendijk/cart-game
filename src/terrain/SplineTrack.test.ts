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

describe("SplineTrack — pointAtArc (arc-length parameterization)", () => {
  // Stretched ellipse (a=80, b=25) sampled at 16 uniform angles: a simple
  // closed convex loop. Its min radius of curvature (~b^2/a ~= 7.8m) is high
  // enough that, at a 2m arc step, chord ~= arc within 2%, while the
  // eccentricity means uniform-t (getPoint) still bunches at the tight ends
  // relative to arc-length — the motivation for pointAtArc.
  const ECCENTRIC_CONTROL: ReadonlyArray<readonly [number, number, number]> = [
    [80, 0, 0],
    [73.9, 0, 9.6],
    [56.6, 0, 17.7],
    [30.6, 0, 23.1],
    [0, 0, 25],
    [-30.6, 0, 23.1],
    [-56.6, 0, 17.7],
    [-73.9, 0, 9.6],
    [-80, 0, 0],
    [-73.9, 0, -9.6],
    [-56.6, 0, -17.7],
    [-30.6, 0, -23.1],
    [0, 0, -25],
    [30.6, 0, -23.1],
    [56.6, 0, -17.7],
    [73.9, 0, -9.6],
  ];

  it("arc-length spacing is even (< 2% error) around an eccentric loop", () => {
    const t = new SplineTrack(ECCENTRIC_CONTROL, 1024);
    const step = 2; // metres; small enough that chord ~= arc within 2%
    const count = Math.floor(t.loopLength / step);
    let minChord = Infinity;
    let maxChord = 0;
    let prev = t.pointAtArc(0);
    for (let i = 1; i <= count; i++) {
      const p = t.pointAtArc(i * step);
      const d = p.distanceTo(prev);
      minChord = Math.min(minChord, d);
      maxChord = Math.max(maxChord, d);
      prev = p.clone();
    }
    expect(maxChord - minChord).toBeLessThan(step * 0.02);
  });

  it("pointAtArc(0) ~= pointAtArc(loopLength) (wrap to start)", () => {
    const t = new SplineTrack(ECCENTRIC_CONTROL, 1024);
    const a = t.pointAtArc(0);
    const b = t.pointAtArc(t.loopLength);
    expect(a.distanceTo(b)).toBeLessThan(1e-2);
  });

  it("pointAtArc(loopLength + x) ~= pointAtArc(x) (wrap past one lap)", () => {
    const t = new SplineTrack(ECCENTRIC_CONTROL, 1024);
    const x = 7.3;
    const a = t.pointAtArc(x);
    const b = t.pointAtArc(t.loopLength + x);
    expect(a.distanceTo(b)).toBeLessThan(1e-2);
  });

  it("pointAtArc(-x) wraps correctly (negative)", () => {
    const t = new SplineTrack(ECCENTRIC_CONTROL, 1024);
    const x = 11.2;
    const a = t.pointAtArc(t.loopLength - x);
    const b = t.pointAtArc(-x);
    expect(a.distanceTo(b)).toBeLessThan(1e-2);
  });

  it("pointAtArc returns the passed-in out Vector3 (reusable out vector)", () => {
    const t = new SplineTrack(ECCENTRIC_CONTROL, 1024);
    const out = new Vector3();
    const r = t.pointAtArc(42, out);
    expect(r).toBe(out);
    expect(out.length()).toBeGreaterThan(0);
  });
});
