import { describe, expect, it } from "vitest";
import {
  buildAttempt,
  generateCircuit,
  tamedOpts,
  validateCircuit,
  FALLBACK_SEED,
  ROAD_WATER_CLEARANCE,
  type CircuitAnalysis,
} from "./circuit";

const SEEDS = 5000;
const LEN_MIN = 588;
const LEN_MAX = 1530;
const WORLD_CAP = 768;

describe("generateCircuit — 5000-seed validity sweep", () => {
  it("every seed: valid, length, worldSize, extent; shape floors hold", () => {
    let minRadius = Infinity;
    let minSepNear = Infinity;
    let minSepFar = Infinity;
    let maxWorld = 0;
    const analyses: CircuitAnalysis[] = [];
    for (let seed = 0; seed < SEEDS; seed++) {
      const c = generateCircuit(seed);
      const v = validateCircuit(c.control);
      // Drivability: radius >= 12.5, no self-intersection, tiered separation.
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
      analyses.push(v);
      minRadius = Math.min(minRadius, v.minRadius);
      minSepNear = Math.min(minSepNear, v.sepNear);
      minSepFar = Math.min(minSepFar, v.sepFar);
      maxWorld = Math.max(maxWorld, c.worldSize);
    }
    expect(minRadius).toBeGreaterThanOrEqual(12.5);
    expect(minSepNear).toBeGreaterThanOrEqual(18);
    expect(minSepFar).toBeGreaterThanOrEqual(30);
    expect(maxWorld).toBeLessThanOrEqual(WORLD_CAP);

    // Shape-quality floors: the whole point of 057 is real variety (hairpin
    // bays, esses, corner-rich flow), so the sweep asserts distribution
    // floors. If the generator ever regresses toward ovals, these fail long
    // before a human notices in-game. Measured on this build: hairpins 95%,
    // esses 63%, corners>=6 78%, straights>=60m 83%.
    const frac = (f: (v: CircuitAnalysis) => boolean): number =>
      analyses.filter(f).length / analyses.length;
    expect(frac((v) => v.hairpins >= 1)).toBeGreaterThanOrEqual(0.85);
    expect(frac((v) => v.sBends >= 2)).toBeGreaterThanOrEqual(0.5);
    expect(frac((v) => v.cornerCount >= 6)).toBeGreaterThanOrEqual(0.65);
    expect(frac((v) => v.longestStraight >= 60)).toBeGreaterThanOrEqual(0.7);
    // ~50 s standalone; generous timeout for parallel-suite contention.
  }, 180000);
});

describe("generateCircuit — fallback", () => {
  it("the fallback draw is valid AND interesting (termination guarantee)", () => {
    // generateCircuit returns buildAttempt(FALLBACK_SEED, 0, tamedOpts(0))
    // when every attempt fails; this asserts that exact draw stays valid so
    // every seed is guaranteed to terminate with a drivable loop.
    const plan = buildAttempt(FALLBACK_SEED, 0, tamedOpts(0));
    const v = validateCircuit(plan.control);
    expect(v.ok).toBe(true);
    expect(v.length).toBeGreaterThanOrEqual(LEN_MIN);
    expect(v.length).toBeLessThanOrEqual(LEN_MAX);
    expect(plan.worldSize).toBeLessThanOrEqual(WORLD_CAP);
    expect(v.hairpins).toBeGreaterThanOrEqual(1);
    expect(v.cornerCount).toBeGreaterThanOrEqual(6);
  });
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

describe("generateCircuit — water clearance", () => {
  it("every control Y >= waterLevel + clearance when waterLevel is given", () => {
    const wl = -2;
    const floor = wl + ROAD_WATER_CLEARANCE;
    for (let seed = 0; seed < 300; seed++) {
      const c = generateCircuit(seed, undefined, wl);
      for (const p of c.control) {
        expect(p[1]).toBeGreaterThanOrEqual(floor - 1e-6);
      }
    }
  });

  it("waterLevel undefined leaves valleys unconstrained (negatives appear)", () => {
    let minY = Infinity;
    for (let seed = 0; seed < 300; seed++) {
      const c = generateCircuit(seed);
      for (const p of c.control) minY = Math.min(minY, p[1]);
    }
    // The raw zero-mean profile reliably dips below the tropical floor (-0.5).
    expect(minY).toBeLessThan(-0.5);
  });

  it("water clearance does not break validity or determinism", () => {
    const wl = -2;
    for (let seed = 0; seed < 50; seed++) {
      const a = generateCircuit(seed, undefined, wl);
      const b = generateCircuit(seed, undefined, wl);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const v = validateCircuit(a.control);
      expect(v.ok).toBe(true);
    }
  });
});
