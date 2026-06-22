import { describe, expect, it } from "vitest";
import { clamp01, hashSeed, makeRNG, mulberry32, smoothstep } from "./rng";

describe("mulberry32", () => {
  it("produces floats in [0,1)", () => {
    const r = mulberry32(1337);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic: same seed -> same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds (collision guard)", () => {
    const a = Array.from({ length: 16 }, () => mulberry32(1)());
    const b = Array.from({ length: 16 }, () => mulberry32(2)());
    expect(a).not.toEqual(b);
  });

  it("coerces negative/non-32-bit seeds to uint32 identically", () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337 + 2 ** 32);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });
});

describe("makeRNG", () => {
  it("same seed reproduces identical next/range/unit sequences", () => {
    const a = makeRNG(7);
    const b = makeRNG(7);
    for (let i = 0; i < 32; i++) {
      expect(a.next()).toBe(b.next());
      expect(a.range(-5, 5)).toBe(b.range(-5, 5));
      expect(a.unit()).toBe(b.unit());
    }
  });

  it("range stays within [min,max)", () => {
    const r = makeRNG(99);
    for (let i = 0; i < 2000; i++) {
      const v = r.range(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
    }
  });

  it("unit stays within [-1,1)", () => {
    const r = makeRNG(5);
    for (let i = 0; i < 2000; i++) {
      const v = r.unit();
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it("pick returns only elements of the array", () => {
    const arr = [10, 20, 30] as const;
    const r = makeRNG(123);
    for (let i = 0; i < 500; i++) {
      expect(arr).toContain(r.pick(arr));
    }
  });

  it("pick distributes across all indices (uses each at least once)", () => {
    const arr = ["a", "b", "c", "d"];
    const r = makeRNG(2024);
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) seen.add(r.pick(arr));
    expect(seen.size).toBe(arr.length);
  });

  it("pick throws on an empty array", () => {
    const r = makeRNG(1);
    expect(() => r.pick([])).toThrow(/empty/);
  });

  it("exposes the uint32 seed", () => {
    expect(makeRNG(1337).seed).toBe(1337);
    expect(makeRNG(-1).seed).toBe(0xffffffff);
  });
});

describe("hashSeed", () => {
  it("is stable for the same string", () => {
    expect(hashSeed("tree")).toBe(hashSeed("tree"));
    expect(hashSeed("rock")).toBe(hashSeed("rock"));
  });

  it("returns a uint32", () => {
    const h = hashSeed("bush");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("differs across distinct strings", () => {
    expect(hashSeed("tree")).not.toBe(hashSeed("trees"));
    expect(hashSeed("flower")).not.toBe(hashSeed("grass"));
  });
});

describe("smoothstep", () => {
  it("clamps below e0 to 0 and above e1 to 1", () => {
    expect(smoothstep(2, 5, -1)).toBe(0);
    expect(smoothstep(2, 5, 2)).toBe(0);
    expect(smoothstep(2, 5, 5)).toBe(1);
    expect(smoothstep(2, 5, 99)).toBe(1);
  });

  it("is 0.5 at the midpoint and monotonic", () => {
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 6);
    const prev = smoothstep(0, 10, 3);
    const next = smoothstep(0, 10, 4);
    expect(next).toBeGreaterThan(prev);
  });

  it("is a hard step when e0===e1 (no divide-by-zero)", () => {
    expect(smoothstep(4, 4, 3)).toBe(0);
    expect(smoothstep(4, 4, 4)).toBe(1);
    expect(smoothstep(4, 4, 5)).toBe(1);
  });
});

describe("clamp01", () => {
  it("clamps to [0,1]", () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(9)).toBe(1);
  });
});
