import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { computeGrid, TRACK_HALF_WIDTH, type GridPath } from "./KartGrid";

/**
 * Fake circular loop of radius R in XZ, ccw: point = (R cos 2πt, 0, R sin 2πt).
 * Tangent (unit) = (-sin 2πt, 0, cos 2πt). Start line at t=0: (R,0,0) +Z fwd.
 */
function circlePath(radius: number): GridPath {
  const R = radius;
  return {
    getPoint(t: number, out: Vector3): Vector3 {
      const a = Math.PI * 2 * (((t % 1) + 1) % 1);
      return out.set(R * Math.cos(a), 0, R * Math.sin(a));
    },
    getTangent(t: number): Vector3 {
      const a = Math.PI * 2 * (((t % 1) + 1) % 1);
      return new Vector3(-Math.sin(a), 0, Math.cos(a));
    },
  };
}

describe("computeGrid", () => {
  it("returns N spawns (and empty for n<=0)", () => {
    const path = circlePath(60);
    const h = () => 0;
    expect(computeGrid(path, h, 0)).toHaveLength(0);
    expect(computeGrid(path, h, 6)).toHaveLength(6);
  });

  it("places every spawn within the corridor (lateral < trackHalfWidth)", () => {
    const path = circlePath(60);
    const h = () => 0;
    const spawns = computeGrid(path, h, 6);
    const start = path.getPoint(0, new Vector3());
    for (const s of spawns) {
      // Horizontal distance from the centreline (the circle) = |dist - R|.
      const r = Math.hypot(s.pos.x - 0, s.pos.z - 0);
      expect(Math.abs(r - 60)).toBeLessThan(TRACK_HALF_WIDTH);
      void start;
    }
  });

  it("places every spawn behind the start line (negative forward projection)", () => {
    const path = circlePath(60);
    const h = () => 0;
    const start = path.getPoint(0, new Vector3());
    const fwd = path.getTangent(0); // +Z at t=0
    const spawns = computeGrid(path, h, 6);
    for (const s of spawns) {
      const dx = s.pos.x - start.x;
      const dz = s.pos.z - start.z;
      const forwardProj = dx * fwd.x + dz * fwd.z;
      expect(forwardProj).toBeLessThan(0.5); // behind (or on) the line
    }
  });

  it("rows step backwards monotonically by the longitudinal gap", () => {
    const path = circlePath(60);
    const h = () => 0;
    const spawns = computeGrid(path, h, 6, { columns: 2, longitudinalGap: 3 });
    const start = path.getPoint(0, new Vector3());
    const fwd = path.getTangent(0);
    // Row of kart 0 and kart 2 (same column, consecutive rows).
    const proj = (s: { pos: Vector3 }): number =>
      (s.pos.x - start.x) * fwd.x + (s.pos.z - start.z) * fwd.z;
    // Both behind; row 2 (kart 2) is further behind than row 1 (kart 0).
    expect(proj(spawns[2]!)).toBeLessThan(proj(spawns[0]!));
  });

  it("all spawns are distinct", () => {
    const path = circlePath(60);
    const h = () => 0;
    const spawns = computeGrid(path, h, 6);
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        expect(spawns[i]!.pos.distanceTo(spawns[j]!.pos)).toBeGreaterThan(0.1);
      }
    }
  });

  it("spawns stay within world bounds (inside the radius-60 loop perimeter)", () => {
    const path = circlePath(60);
    const h = () => 0;
    const spawns = computeGrid(path, h, 6);
    for (const s of spawns) {
      const r = Math.hypot(s.pos.x, s.pos.z);
      expect(r).toBeLessThan(75); // well inside the world half-extent (100)
      expect(r).toBeGreaterThan(45);
    }
  });

  it("Y matches the fake heightAt + clearance", () => {
    const path = circlePath(60);
    const h = (x: number, z: number) => 10 + 0.1 * x + 0.2 * z;
    const spawns = computeGrid(path, h, 4, { clearance: 0.5 });
    for (const s of spawns) {
      expect(s.pos.y).toBeCloseTo(h(s.pos.x, s.pos.z) + 0.5, 5);
    }
  });

  it("yaw aligns forward (-Z) with the local tangent at the spawn t", () => {
    const path = circlePath(60);
    const h = () => 0;
    const spawns = computeGrid(path, h, 2);
    for (const s of spawns) {
      // forward = (-sin yaw, 0, -cos yaw) should be a unit vector pointing
      // along the travel direction; reconstruct and compare to a fresh tangent
      // sampled near the spawn by matching the start orientation convention.
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      expect(Math.hypot(fx, fz)).toBeCloseTo(1, 5);
      // Both spawns face "forward" (+Z half-plane near the start line).
      expect(fz).toBeGreaterThan(0);
    }
  });

  it("is deterministic: same inputs -> identical spawns", () => {
    const path = circlePath(60);
    const h = () => 1;
    const a = computeGrid(path, h, 6);
    const b = computeGrid(path, h, 6);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.pos.toArray()).toEqual(b[i]!.pos.toArray());
      expect(a[i]!.yaw).toBe(b[i]!.yaw);
    }
  });

  it("keeps the 2-column straddle at +/-lateral (unchanged default)", () => {
    const path = circlePath(60);
    const h = () => 0;
    const lateral = 2.0;
    const spawns = computeGrid(path, h, 2, { columns: 2, lateral });
    const first = spawns[0]!.pos;
    const last = spawns[1]!.pos;
    const span = Math.hypot(last.x - first.x, last.z - first.z);
    expect(span).toBeCloseTo(2 * lateral, 5);
    const mid = new Vector3((first.x + last.x) / 2, 0, (first.z + last.z) / 2);
    const d0 = Math.hypot(first.x - mid.x, first.z - mid.z);
    const d1 = Math.hypot(last.x - mid.x, last.z - mid.z);
    expect(d0).toBeCloseTo(lateral, 5);
    expect(d1).toBeCloseTo(lateral, 5);
  });

  it("spreads columns > 2 laterally across [-1, 1] without overlap", () => {
    const path = circlePath(60);
    const h = () => 0;
    const lateral = 2.0;
    const expected: Record<number, number[]> = {
      3: [-1, 0, 1],
      4: [-1, -1 / 3, 1 / 3, 1],
    };
    for (const columns of [3, 4]) {
      const spawns = computeGrid(path, h, columns, { columns, lateral });
      expect(spawns).toHaveLength(columns);
      const first = spawns[0]!.pos;
      const last = spawns[columns - 1]!.pos;
      const dir = new Vector3(last.x - first.x, 0, last.z - first.z).normalize();
      const span = Math.hypot(last.x - first.x, last.z - first.z);
      expect(span).toBeCloseTo(2 * lateral, 5);
      const norm = spawns.map((s) => {
        const proj = (s.pos.x - first.x) * dir.x + (s.pos.z - first.z) * dir.z;
        return (2 * proj) / span - 1;
      });
      for (let c = 0; c < columns; c++) {
        expect(norm[c]).toBeCloseTo(expected[columns]![c]!, 5);
      }
      expect(new Set(norm).size).toBe(columns);
    }
  });
});
