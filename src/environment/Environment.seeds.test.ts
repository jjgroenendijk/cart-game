import { describe, expect, it } from "vitest";
import { worldSubSeeds } from "./Environment";

describe("worldSubSeeds (078)", () => {
  it("each subsystem seed is a uint32", () => {
    const sub = worldSubSeeds(0x12345678);
    for (const [label, s] of Object.entries(sub)) {
      expect(Number.isInteger(s), `${label} integer`).toBe(true);
      expect(s, `${label} range`).toBeGreaterThanOrEqual(0);
      expect(s, `${label} range`).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("uses the hashSeed(label) ^ seed convention", () => {
    const sub = worldSubSeeds(42);
    // Mirrors selectBiome / weather's idiom exactly.
    const expected = (label: string) => (fnvHash(label) ^ (42 >>> 0)) >>> 0;
    expect(sub.dressing).toBe(expected("dressing"));
    expect(sub.clouds).toBe(expected("clouds"));
    expect(sub.weather).toBe(expected("weather"));
    expect(sub.wildlife).toBe(expected("wildlife"));
  });

  it("different seeds -> different subsystem seeds (varies the world)", () => {
    const a = worldSubSeeds(1);
    const b = worldSubSeeds(2);
    expect(a.dressing).not.toBe(b.dressing);
    expect(a.clouds).not.toBe(b.clouds);
    expect(a.weather).not.toBe(b.weather);
    expect(a.wildlife).not.toBe(b.wildlife);
  });

  it("labels vary independently within one seed", () => {
    const sub = worldSubSeeds(99);
    const vals = new Set(Object.values(sub));
    expect(vals.size).toBe(4); // all four labels differ
  });
});

/** Mirror of src/core/rng.ts hashSeed (FNV-1a 32-bit) for local assertions. */
function fnvHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
