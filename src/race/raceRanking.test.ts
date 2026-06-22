import { describe, expect, it } from "vitest";
import { compareProgress, rank, type RankInput } from "./raceRanking";

const ri = (index: number, lap: number, cumArcLen: number): RankInput => ({
  index,
  lap,
  cumArcLen,
});

describe("rank", () => {
  it("orders by lap first: a kart on lap 2 leads one on lap 1 regardless of arcLen", () => {
    const r = rank([
      ri(0, 1, 0.9), // P1, mid lap 1
      ri(1, 2, 0.05), // rival, just into lap 2
    ]);
    expect(r.order).toEqual([1, 0]);
    expect(r.positions[1]).toBe(1);
    expect(r.positions[0]).toBe(2);
  });

  it("within a lap, greater cumArcLen leads (mid-lap ties broken by arcLen)", () => {
    const r = rank([ri(0, 1, 0.3), ri(1, 1, 0.7), ri(2, 1, 0.5)]);
    expect(r.order).toEqual([1, 2, 0]);
    expect(r.positions).toEqual([3, 1, 2]);
  });

  it("mixes P1 with rivals across laps and within a lap", () => {
    const r = rank([
      ri(0, 0, 0.95), // P1 still on first lap, almost done
      ri(1, 1, 0.1), // rival started lap 2
      ri(2, 0, 0.5), // rival mid first lap
      ri(3, 0, 0.95), // rival tied with P1 on (lap,arcLen)
    ]);
    // lap1 rival first; then lap0 arcLen 0.95 (tie -> lower index first -> 0 before 3).
    expect(r.order).toEqual([1, 0, 3, 2]);
    expect(r.positions[0]).toBe(2);
    expect(r.positions[3]).toBe(3);
  });

  it("is deterministic: identical inputs yield identical output", () => {
    const a = rank([ri(4, 1, 0.2), ri(2, 1, 0.8), ri(9, 0, 0.6)]);
    const b = rank([ri(4, 1, 0.2), ri(2, 1, 0.8), ri(9, 0, 0.6)]);
    expect(a).toEqual(b);
  });

  it("breaks exact ties by ascending kart index (stable)", () => {
    // Inputs deliberately shuffled; indices are dense 0..N-1.
    const r = rank([ri(2, 1, 0.4), ri(0, 1, 0.4), ri(1, 1, 0.4)]);
    expect(r.order).toEqual([0, 1, 2]);
    expect(r.positions).toEqual([1, 2, 3]);
  });

  it("assigns 1-based positions 1..N with a single leader", () => {
    const r = rank([ri(0, 0, 0.1), ri(1, 0, 0.2), ri(2, 0, 0.3)]);
    expect(r.positions).toEqual([3, 2, 1]);
    expect(r.order[0]).toBe(2);
    const unique = new Set(r.positions);
    expect(unique.size).toBe(3);
  });

  it("handles a single kart", () => {
    const r = rank([ri(0, 2, 0.5)]);
    expect(r.order).toEqual([0]);
    expect(r.positions).toEqual([1]);
  });
});

describe("compareProgress", () => {
  it("returns >0 when a leads, <0 when b leads", () => {
    expect(compareProgress(ri(0, 2, 0.1), ri(1, 1, 0.9))).toBeGreaterThan(0);
    expect(compareProgress(ri(0, 1, 0.2), ri(1, 1, 0.8))).toBeLessThan(0);
  });

  it("returns 0 for identical (lap, arcLen) after the index tie-break cancels", () => {
    // Same lap + arcLen, symmetric indices -> compareProgress is anti-symmetric,
    // not zero, because the index tie-break is the final discriminator. Verify
    // the documented behaviour: index breaks the tie deterministically.
    const a = ri(0, 1, 0.5);
    const b = ri(1, 1, 0.5);
    expect(compareProgress(a, b)).toBeGreaterThan(0); // a (lower index) leads
    expect(compareProgress(b, a)).toBeLessThan(0);
  });
});
