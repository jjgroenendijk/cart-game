import { describe, expect, it } from "vitest";
import { advancePosition, type ParticleVec3 } from "./Weather";

describe("advancePosition", () => {
  const mod = (v: number, s: number): number => ((v % s) + s) % s;

  it("t=0 returns base exactly (base inside the box)", () => {
    const base: ParticleVec3 = { x: 12, y: 5, z: -7 };
    const vel: ParticleVec3 = { x: 10, y: -25, z: 4 };
    const r = advancePosition(base, vel, 0, 100, 60);
    expect(r.x).toBeCloseTo(base.x, 6);
    expect(r.y).toBeCloseTo(base.y, 6);
    expect(r.z).toBeCloseTo(base.z, 6);
  });

  it("X bidirectional wrap: +vel crossing +half lands in [-half, half)", () => {
    const half = 50;
    const vel = 10;
    const base = 49.5;
    const t = 0.2; // 49.5 + 10*0.2 = 51.5 -> crosses +half
    const r = advancePosition({ x: base, y: 5, z: 0 }, { x: vel, y: -1, z: 0 }, t, half, 12);
    const expected = mod(base + vel * t + half, 2 * half) - half;
    expect(r.x).toBeCloseTo(expected, 6);
    expect(r.x).toBeGreaterThanOrEqual(-half);
    expect(r.x).toBeLessThan(half);
  });

  it("X bidirectional wrap: -vel crossing -half wraps the other way", () => {
    const half = 50;
    const vel = -10;
    const base = -49.5;
    const t = 0.2; // -49.5 - 10*0.2 = -51.5 -> crosses -half
    const r = advancePosition({ x: base, y: 5, z: 0 }, { x: vel, y: -1, z: 0 }, t, half, 12);
    const expected = mod(base + vel * t + half, 2 * half) - half;
    expect(r.x).toBeCloseTo(expected, 6);
    expect(r.x).toBeGreaterThanOrEqual(-half);
    expect(r.x).toBeLessThan(half);
  });

  it("Z wrap is independent and the same shape as X", () => {
    const half = 50;
    const vel = 10;
    const base = 49.5;
    const t = 0.3;
    const r = advancePosition({ x: 0, y: 5, z: base }, { x: 0, y: -1, z: vel }, t, half, 12);
    const expected = mod(base + vel * t + half, 2 * half) - half;
    expect(r.z).toBeCloseTo(expected, 6);
    expect(r.z).toBeGreaterThanOrEqual(-half);
    expect(r.z).toBeLessThan(half);
    // X untouched (base.x = 0, vel.x = 0)
    expect(r.x).toBeCloseTo(0, 6);
  });

  it("Y ceiling reset: fall > ceiling keeps y in [0, ceiling]", () => {
    const ceiling = 12;
    const baseY = 11;
    const vy = -25;
    const t = 1.5; // fall = (12 - 11) + 25*1.5 = 39.5 > ceiling
    const r = advancePosition({ x: 0, y: baseY, z: 0 }, { x: 0, y: vy, z: 0 }, t, 100, ceiling);
    const fall = ceiling - baseY + -vy * t;
    const expected = ceiling - mod(fall, ceiling);
    expect(r.y).toBeCloseTo(expected, 6);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(ceiling);
  });

  it("Y stays in [0, ceiling] as t grows", () => {
    const ceiling = 12;
    const baseY = 11;
    const vy = -25;
    for (const t of [0.1, 1, 5, 50, 1000]) {
      const r = advancePosition({ x: 0, y: baseY, z: 0 }, { x: 0, y: vy, z: 0 }, t, 100, ceiling);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThanOrEqual(ceiling);
    }
  });

  it("Y periodicity: period = ceiling / -vel.y returns y ~= t=0", () => {
    const ceiling = 12;
    const baseY = 11;
    const vy = -25;
    const period = ceiling / -vy; // 0.48
    const r0 = advancePosition({ x: 0, y: baseY, z: 0 }, { x: 0, y: vy, z: 0 }, 0, 100, ceiling);
    const rp = advancePosition(
      { x: 0, y: baseY, z: 0 },
      { x: 0, y: vy, z: 0 },
      period,
      100,
      ceiling,
    );
    expect(rp.y).toBeCloseTo(r0.y, 6);
  });

  it("X periodicity: period = (2*half) / |vel.x| returns x ~= t=0", () => {
    const half = 50;
    const vx = 10;
    const baseX = 49.5;
    const period = (2 * half) / Math.abs(vx); // 10
    const r0 = advancePosition({ x: baseX, y: 5, z: 0 }, { x: vx, y: -1, z: 0 }, 0, half, 12);
    const rp = advancePosition({ x: baseX, y: 5, z: 0 }, { x: vx, y: -1, z: 0 }, period, half, 12);
    expect(rp.x).toBeCloseTo(r0.x, 6);
  });

  it("determinism: same inputs -> same outputs", () => {
    const base: ParticleVec3 = { x: 3.3, y: 4, z: -2.2 };
    const vel: ParticleVec3 = { x: 7, y: -9, z: 1.5 };
    const a = advancePosition(base, vel, 1.7, 50, 12);
    const b = advancePosition(base, vel, 1.7, 50, 12);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });

  it("focus=0 matches the legacy origin-anchored wrap", () => {
    const base: ParticleVec3 = { x: 12, y: 5, z: -7 };
    const vel: ParticleVec3 = { x: 4, y: -2, z: 1 };
    const r0 = advancePosition(base, vel, 3, 50, 12);
    const rDefault = advancePosition(base, vel, 3, 50, 12, 0, 0);
    expect(rDefault.x).toBeCloseTo(r0.x, 6);
    expect(rDefault.z).toBeCloseTo(r0.z, 6);
  });

  it("world-stationarity: shifting focus keeps a mid-box particle fixed", () => {
    const half = 50;
    const base: ParticleVec3 = { x: 10, y: 5, z: 10 };
    const vel: ParticleVec3 = { x: 0, y: -1, z: 0 };
    const r0 = advancePosition(base, vel, 0, half, 12, 0, 0);
    const r5 = advancePosition(base, vel, 0, half, 12, 5, 5);
    expect(r5.x).toBeCloseTo(r0.x, 6);
    expect(r5.z).toBeCloseTo(r0.z, 6);
  });

  it("world-stationarity with wind: focus shift does not add to world position", () => {
    const half = 50;
    const base: ParticleVec3 = { x: 0, y: 5, z: 0 };
    const vel: ParticleVec3 = { x: 3, y: -1, z: 1 };
    const t = 4;
    const r0 = advancePosition(base, vel, t, half, 12, 0, 0);
    const rShift = advancePosition(base, vel, t, half, 12, 17, -23);
    expect(rShift.x).toBeCloseTo(r0.x, 6);
    expect(rShift.z).toBeCloseTo(r0.z, 6);
  });

  it("recycle: a particle left behind past focus-half recycles ahead", () => {
    const half = 50;
    const span = 2 * half;
    const base: ParticleVec3 = { x: 0, y: 5, z: 0 };
    const vel: ParticleVec3 = { x: 0, y: -1, z: 0 };
    // focus far ahead: particle at world 0 is now behind focus by > half
    const r = advancePosition(base, vel, 0, half, 12, 70, 0);
    // recycled to span ahead of focus offset -> world stays in [focus-half, focus+half]
    expect(r.x).toBeCloseTo(base.x + span, 6);
    expect(r.x).toBeGreaterThanOrEqual(70 - half);
    expect(r.x).toBeLessThan(70 + half);
  });
});
