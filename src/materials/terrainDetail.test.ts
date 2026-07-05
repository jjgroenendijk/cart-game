import { describe, expect, it } from "vitest";
import {
  DETAIL_ALBEDO_SNIPPET,
  DETAIL_DEFAULTS,
  DETAIL_NOISE_FN,
  DETAIL_NORMAL_SNIPPET,
  fbm,
  hash2,
  terrainDetailForTier,
  vnoise,
  type TerrainDetailParams,
} from "./terrainDetail";

describe("hash2", () => {
  it("is deterministic: same inputs -> same output", () => {
    expect(hash2(1.5, 2.5)).toBe(hash2(1.5, 2.5));
  });

  it("returns a value in [0,1) across a range of inputs", () => {
    const xs = [0, 1, -1, 3.7, -2.5, 100, -50.25];
    const ys = [0, 1, -1, 4.2, -3.3, 50, 77.125];
    for (const x of xs) {
      for (const y of ys) {
        const h = hash2(x, y);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it("distinguishes distinct input pairs (usually)", () => {
    expect(hash2(1, 2)).not.toBe(hash2(2, 1));
    expect(hash2(3.3, 4.4)).not.toBe(hash2(4.4, 3.3));
    expect(hash2(10, -10)).not.toBe(hash2(-10, 10));
  });
});

describe("vnoise", () => {
  it("returns a value in [0,1] across sample inputs", () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [0.5, 0.5],
      [1.3, 2.7],
      [-1.1, -2.2],
      [10.6, -4.4],
      [3.3, 3.3],
      [7.7, -8.8],
      [12.25, 0.75],
    ];
    for (const [x, y] of pts) {
      const v = vnoise(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    expect(vnoise(2.3, 4.8)).toBe(vnoise(2.3, 4.8));
  });

  it("at an integer lattice corner equals hash2 at that corner (f=0 -> c00)", () => {
    expect(vnoise(5, 7)).toBeCloseTo(hash2(5, 7), 6);
    expect(vnoise(0, 0)).toBeCloseTo(hash2(0, 0), 6);
    expect(vnoise(-3, 11)).toBeCloseTo(hash2(-3, 11), 6);
  });
});

describe("fbm", () => {
  const pts: Array<[number, number]> = [
    [0.1, 0.2],
    [1.7, 3.3],
    [-2.5, 4.1],
    [10.3, -7.7],
    [6.6, 6.6],
    [0.9, 5.5],
    [12.4, -1.2],
    [-8.8, -9.9],
    [2.2, 2.2],
    [4.4, 5.5],
    [3.1, -0.6],
    [-4.4, 7.7],
    [9.9, 9.9],
    [0.01, 0.99],
    [15.5, -3.3],
    [-1.1, -1.1],
    [8.2, 4.4],
    [5.5, 1.3],
    [-6.6, 2.2],
    [11.1, 11.1],
  ];

  it("stays in [0,1] across inputs for octave counts {1,2,3,4}", () => {
    for (const [x, y] of pts) {
      for (const oct of [1, 2, 3, 4]) {
        const v = fbm(x, y, oct);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic", () => {
    expect(fbm(2.3, 4.8, 3)).toBe(fbm(2.3, 4.8, 3));
  });

  it("clamps octaves to an integer >= 1", () => {
    const x = 1.4;
    const y = 2.6;
    expect(fbm(x, y, 0)).toBe(fbm(x, y, 1));
    expect(fbm(x, y, 2.7)).toBe(fbm(x, y, 3));
    expect(fbm(x, y, -1)).toBe(fbm(x, y, 1));
  });

  it("more octaves change the value at sample points (octave monotonicity)", () => {
    let changed = 0;
    for (const [x, y] of pts) {
      if (Math.abs(fbm(x, y, 3) - fbm(x, y, 1)) > 1e-6) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe("DETAIL_DEFAULTS", () => {
  it("has positive strength, scale, bump and an integer octave count in [1,4]", () => {
    expect(DETAIL_DEFAULTS.strength).toBeGreaterThan(0);
    expect(DETAIL_DEFAULTS.scale).toBeGreaterThan(0);
    expect(DETAIL_DEFAULTS.bump).toBeGreaterThan(0);
    expect(Number.isInteger(DETAIL_DEFAULTS.octaves)).toBe(true);
    expect(DETAIL_DEFAULTS.octaves).toBeGreaterThanOrEqual(1);
    expect(DETAIL_DEFAULTS.octaves).toBeLessThanOrEqual(4);
  });
});

describe("terrainDetailForTier", () => {
  it("low tier is disabled with all numeric params zero (byte-identical to pre-069)", () => {
    const low = terrainDetailForTier("low");
    expect(low.enabled).toBe(false);
    expect(low.strength).toBe(0);
    expect(low.scale).toBe(0);
    expect(low.bump).toBe(0);
    expect(low.octaves).toBe(0);
  });

  it("med tier is enabled with 2 octaves and conservative strength/bump", () => {
    const med = terrainDetailForTier("med");
    expect(med.enabled).toBe(true);
    expect(med.octaves).toBe(2);
    expect(med.strength).toBeGreaterThan(0);
    expect(med.bump).toBeGreaterThan(0);
    expect(med.bump).toBeLessThanOrEqual(med.strength);
  });

  it("high tier is enabled with 3 octaves and full DETAIL_DEFAULTS params", () => {
    const high = terrainDetailForTier("high");
    expect(high.enabled).toBe(true);
    expect(high.octaves).toBe(3);
    expect(high.strength).toBe(DETAIL_DEFAULTS.strength);
    expect(high.scale).toBe(DETAIL_DEFAULTS.scale);
    expect(high.bump).toBe(DETAIL_DEFAULTS.bump);
  });

  it("tiers escalate: med.octaves < high.octaves, high.strength/scale >= med", () => {
    const med = terrainDetailForTier("med");
    const high = terrainDetailForTier("high");
    expect(med.octaves).toBeLessThan(high.octaves);
    expect(high.strength).toBeGreaterThanOrEqual(med.strength);
    expect(high.bump).toBeGreaterThanOrEqual(med.bump);
  });

  it("returns a fully-typed TerrainDetailParams", () => {
    const p: TerrainDetailParams = terrainDetailForTier("high");
    expect(p).toBeDefined();
  });

  it("throws on an unknown tier", () => {
    expect(() => terrainDetailForTier("ultra" as never)).toThrow(/unknown tier/);
  });
});

describe("GLSL source strings", () => {
  it("DETAIL_NOISE_FN defines hash2, vnoise, fbm", () => {
    expect(typeof DETAIL_NOISE_FN).toBe("string");
    expect(DETAIL_NOISE_FN.length).toBeGreaterThan(0);
    expect(DETAIL_NOISE_FN).toContain("hash2");
    expect(DETAIL_NOISE_FN).toContain("vnoise");
    expect(DETAIL_NOISE_FN).toContain("fbm");
  });

  it("DETAIL_ALBEDO_SNIPPET references the albedo apply-site symbols", () => {
    expect(typeof DETAIL_ALBEDO_SNIPPET).toBe("string");
    expect(DETAIL_ALBEDO_SNIPPET.length).toBeGreaterThan(0);
    expect(DETAIL_ALBEDO_SNIPPET).toContain("uDetailStrength");
    expect(DETAIL_ALBEDO_SNIPPET).toContain("uDetailScale");
    expect(DETAIL_ALBEDO_SNIPPET).toContain("fbm(vWorldXZ");
    expect(DETAIL_ALBEDO_SNIPPET).toContain("DETAIL_OCTAVES");
  });

  it("DETAIL_NORMAL_SNIPPET references the normal apply-site symbols", () => {
    expect(typeof DETAIL_NORMAL_SNIPPET).toBe("string");
    expect(DETAIL_NORMAL_SNIPPET.length).toBeGreaterThan(0);
    expect(DETAIL_NORMAL_SNIPPET).toContain("uDetailBump");
    expect(DETAIL_NORMAL_SNIPPET).toContain("Nworld");
    expect(DETAIL_NORMAL_SNIPPET).toContain("uDetailScale");
    expect(DETAIL_NORMAL_SNIPPET).toContain("fbm");
  });
});
