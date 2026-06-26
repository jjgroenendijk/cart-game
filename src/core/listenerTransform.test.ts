import { describe, expect, it } from "vitest";
import { listenerMidpoint } from "./listenerTransform";
import type { Vec3 } from "./math";

describe("listenerMidpoint — 015 listener transform", () => {
  it("empty input -> origin pos, forward {0,0,-1}, zero vel", () => {
    const out = listenerMidpoint([], [], []);
    expect(out.pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(out.forward).toEqual({ x: 0, y: 0, z: -1 });
    expect(out.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("single kart -> that kart's pos/forward/vel", () => {
    const out = listenerMidpoint(
      [{ x: 1, y: 2, z: 3 }],
      [{ x: 0, y: 0, z: -1 }],
      [{ x: 4, y: 5, z: 6 }],
    );
    expect(out.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(out.forward).toEqual({ x: 0, y: 0, z: -1 });
    expect(out.vel).toEqual({ x: 4, y: 5, z: 6 });
  });

  it("two karts -> midpoint pos + averaged vel", () => {
    const out = listenerMidpoint(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      [
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 0, z: -1 },
      ],
      [
        { x: 2, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ],
    );
    expect(out.pos.x).toBe(5);
    expect(out.vel.x).toBe(4);
  });

  it("two aligned forwards -> unit-length forward {0,0,-1}", () => {
    const out = listenerMidpoint(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      [
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 0, z: -1 },
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    );
    expect(out.forward).toEqual({ x: 0, y: 0, z: -1 });
    expect(Math.hypot(out.forward.x, out.forward.y, out.forward.z)).toBeCloseTo(1);
  });

  it("non-unit averaged forward is normalized (x>0, y>0, unit length)", () => {
    const out = listenerMidpoint(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      [
        { x: 3, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    );
    const len = Math.hypot(out.forward.x, out.forward.y, out.forward.z);
    expect(len).toBeCloseTo(1);
    expect(out.forward.x).toBeGreaterThan(0);
    expect(out.forward.y).toBeGreaterThan(0);
  });

  it("is pure + deterministic (same args -> same result)", () => {
    const p: Vec3[] = [
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ];
    const f: Vec3[] = [
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
    ];
    const v: Vec3[] = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    expect(listenerMidpoint(p, f, v)).toEqual(listenerMidpoint(p, f, v));
  });
});
