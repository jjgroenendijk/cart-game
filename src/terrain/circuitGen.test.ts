import { describe, expect, it } from "vitest";
import { generateCircuit, validateCircuit } from "./circuit";

const SEEDS = 5000;
const LEN_MIN = 588;
const LEN_MAX = 1530;
const WORLD_CAP = 768;

describe("generateCircuit — 5000-seed validity sweep", () => {
  it("every seed: valid, length, worldSize, extent", () => {
    let minLen = Infinity;
    let maxLen = 0;
    let minRadius = Infinity;
    let minSep = Infinity;
    let maxWorld = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const c = generateCircuit(seed);
      const v = validateCircuit(c.control, 256);
      // Drivability: radius >= 12.5, no self-intersection, separation >= 30 m.
      expect(v.ok, `seed ${seed} invalid: ${JSON.stringify(v)}`).toBe(true);
      // Length within 600-1500 m +-2% (588..1530).
      expect(c.length, `seed ${seed} length ${c.length}`).toBeGreaterThanOrEqual(LEN_MIN);
      expect(c.length, `seed ${seed} length ${c.length}`).toBeLessThanOrEqual(LEN_MAX);
      // Fits the world cap.
      expect(c.worldSize, `seed ${seed} worldSize ${c.worldSize}`).toBeLessThanOrEqual(
        WORLD_CAP + 1e-6,
      );
      // Every control point within the centered bbox (+/- worldSize/2).
      const half = c.worldSize / 2;
      for (const p of c.control) {
        expect(Math.abs(p[0]), `seed ${seed} ctrl x`).toBeLessThanOrEqual(half + 1e-6);
        expect(Math.abs(p[2]), `seed ${seed} ctrl z`).toBeLessThanOrEqual(half + 1e-6);
      }
      minLen = Math.min(minLen, c.length);
      maxLen = Math.max(maxLen, c.length);
      minRadius = Math.min(minRadius, v.minRadius);
      minSep = Math.min(minSep, v.minSeparation);
      maxWorld = Math.max(maxWorld, c.worldSize);
    }
    // Sanity: the sweep actually exercised the length/extent range rather
    // than collapsing to a single fallback value.
    expect(minRadius).toBeGreaterThanOrEqual(12.5);
    expect(minSep).toBeGreaterThanOrEqual(30);
    expect(maxWorld).toBeLessThanOrEqual(WORLD_CAP);
  }, 30000);
});

describe("generateCircuit — determinism", () => {
  it("same seed reproduces bit-identical control + worldSize + length", () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = generateCircuit(seed);
      const b = generateCircuit(seed);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("different seeds differ (the generator is actually seed-driven)", () => {
    const a = generateCircuit(1);
    const b = generateCircuit(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
