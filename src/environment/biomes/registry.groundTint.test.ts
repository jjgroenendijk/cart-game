import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BIOMES, biomeTerrain, biomeGroundTint } from "./registry";
import { cachedColors } from "../../terrain/heightmap";

describe("biomeGroundTint (243)", () => {
  it("returns the LINEAR grass+road average for the temperate parity baseline", () => {
    const cfg = biomeTerrain("temperate");
    const c = cachedColors(cfg);
    const expected = new THREE.Color(
      (c.grass[0] + c.road[0]) * 0.5,
      (c.grass[1] + c.road[1]) * 0.5,
      (c.grass[2] + c.road[2]) * 0.5,
    );
    const tint = biomeGroundTint("temperate");
    expect(tint.r).toBeCloseTo(expected.r, 5);
    expect(tint.g).toBeCloseTo(expected.g, 5);
    expect(tint.b).toBeCloseTo(expected.b, 5);
  });

  it("accepts a BiomeDefinition (parity with biomeTerrain)", () => {
    // Passing the definition object rather than the id must resolve identically.
    const byId = biomeGroundTint("temperate");
    const byDef = biomeGroundTint(BIOMES.temperate);
    expect(byDef.r).toBeCloseTo(byId.r, 5);
    expect(byDef.g).toBeCloseTo(byId.g, 5);
    expect(byDef.b).toBeCloseTo(byId.b, 5);
  });

  it("yields distinct tints for distinct biomes (biome-driven)", () => {
    const temperate = biomeGroundTint("temperate");
    const tundra = biomeGroundTint("tundra");
    const desert = biomeGroundTint("desert");
    // At least one channel must differ between any two distinct biomes.
    const diff = (a: THREE.Color, b: THREE.Color) =>
      Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    expect(diff(temperate, tundra)).toBeGreaterThan(0);
    expect(diff(temperate, desert)).toBeGreaterThan(0);
  });

  it("returns a fresh THREE.Color instance (no shared scratch)", () => {
    const a = biomeGroundTint("temperate");
    const b = biomeGroundTint("temperate");
    expect(a).not.toBe(b);
    expect(a.equals(b)).toBe(true);
  });
});
