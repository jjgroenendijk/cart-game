import { describe, expect, it } from "vitest";
import {
  generateWidthProfile,
  inStartZone,
  START_MIN_HALF_WIDTH,
  WIDTH_SLOPE_MAX,
  type CurvatureSeries,
} from "./circuitWidth";
import { widthProfileAt } from "./trackGraph";
import { DEFAULT_TRACK_TRAITS, resolveTrackTraits } from "./trackTraits";
import { BIOMES } from "./biomes";
import { generateCircuit } from "./circuit";

const LENGTHS = [600, 944, 1500];

describe("generateWidthProfile (059 sweep)", () => {
  it("stays inside the trait band, respects the start floor + slope cap", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const length of LENGTHS) {
        const p = generateWidthProfile(seed, length, DEFAULT_TRACK_TRAITS);
        const n = p.s.length;
        const step = length / n;
        const maxDelta = WIDTH_SLOPE_MAX * step + 1e-9;
        for (let i = 0; i < n; i++) {
          const hw = p.halfWidth[i]!;
          expect(hw).toBeGreaterThanOrEqual(DEFAULT_TRACK_TRAITS.widthMin - 1e-9);
          expect(hw).toBeLessThanOrEqual(DEFAULT_TRACK_TRAITS.widthMax + 1e-9);
          if (inStartZone(i / n)) {
            expect(hw).toBeGreaterThanOrEqual(START_MIN_HALF_WIDTH - 1e-9);
          }
          const next = p.halfWidth[(i + 1) % n]!;
          expect(Math.abs(next - hw)).toBeLessThanOrEqual(maxDelta);
        }
      }
    }
  });

  it("actually varies the width (not a constant profile)", () => {
    let varied = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const p = generateWidthProfile(seed, 944, DEFAULT_TRACK_TRAITS);
      const min = Math.min(...p.halfWidth);
      const max = Math.max(...p.halfWidth);
      if (max - min > 1) varied++;
    }
    expect(varied).toBeGreaterThanOrEqual(18);
  });

  it("is deterministic in (seed, length, traits)", () => {
    const a = generateWidthProfile(7, 944, DEFAULT_TRACK_TRAITS);
    const b = generateWidthProfile(7, 944, DEFAULT_TRACK_TRAITS);
    expect(a).toEqual(b);
    const c = generateWidthProfile(8, 944, DEFAULT_TRACK_TRAITS);
    expect(c.halfWidth).not.toEqual(a.halfWidth);
  });

  it("biome traits shape the band (alpine narrow, desert wide)", () => {
    const alpine = resolveTrackTraits(BIOMES["alpine"]!.track);
    const desert = resolveTrackTraits(BIOMES["desert"]!.track);
    for (let seed = 1; seed <= 10; seed++) {
      const a = generateWidthProfile(seed, 944, alpine);
      const d = generateWidthProfile(seed, 944, desert);
      for (const hw of a.halfWidth) expect(hw).toBeLessThanOrEqual(7 + 1e-9);
      for (const hw of d.halfWidth) expect(hw).toBeGreaterThanOrEqual(6 - 1e-9);
    }
  });

  it("evaluates seam-continuously through widthProfileAt", () => {
    const length = 944;
    const p = generateWidthProfile(3, length, DEFAULT_TRACK_TRAITS);
    const before = widthProfileAt(p, length - 0.5, length);
    const after = widthProfileAt(p, 0.5, length);
    expect(Math.abs(after - before)).toBeLessThan(2 * WIDTH_SLOPE_MAX + 0.1);
  });
});

describe("generateWidthProfile — corner choreography", () => {
  // Synthetic loop: 900 m ring, one 90 m corner (radius 20) at s in
  // [300, 390], straight everywhere else. ds = 3 m -> 300 samples;
  // width stations every 10 m -> station i sits at s = 10 * i.
  const syntheticCurv = (): CurvatureSeries => {
    const n = 300;
    const kappa = new Float32Array(n);
    for (let i = 100; i < 130; i++) kappa[i] = 1 / 20;
    return { ds: 3, kappa };
  };

  it("pinches the apex below both the approach and the far straight", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const p = generateWidthProfile(seed, 900, DEFAULT_TRACK_TRAITS, syntheticCurv());
      // Deep corner interior (stations 33-36 = s 330-360).
      let apex = Infinity;
      for (let i = 33; i <= 36; i++) apex = Math.min(apex, p.halfWidth[i]!);
      // Approach 40-50 m before the corner (stations 25-26).
      let entry = -Infinity;
      for (let i = 25; i <= 26; i++) entry = Math.max(entry, p.halfWidth[i]!);
      const far = p.halfWidth[60]!; // s = 600, no corner in sight
      expect(apex, `seed ${seed}`).toBeLessThan(entry - 0.5);
      expect(apex, `seed ${seed}`).toBeLessThan(far);
    }
  });

  it("keeps band/floor/slope invariants on real generated circuits", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const c = generateCircuit(seed);
      const n = c.mainWidth.s.length;
      const step = c.length / n;
      const maxDelta = WIDTH_SLOPE_MAX * step + 1e-9;
      for (let i = 0; i < n; i++) {
        const hw = c.mainWidth.halfWidth[i]!;
        expect(hw).toBeGreaterThanOrEqual(DEFAULT_TRACK_TRAITS.widthMin - 1e-9);
        expect(hw).toBeLessThanOrEqual(DEFAULT_TRACK_TRAITS.widthMax + 1e-9);
        if (inStartZone(i / n)) {
          expect(hw).toBeGreaterThanOrEqual(START_MIN_HALF_WIDTH - 1e-9);
        }
        const next = c.mainWidth.halfWidth[(i + 1) % n]!;
        expect(Math.abs(next - hw)).toBeLessThanOrEqual(maxDelta);
      }
    }
  });

  it("holds the start straight wide (line + first 40 m)", () => {
    const p = generateWidthProfile(2, 900, DEFAULT_TRACK_TRAITS, syntheticCurv());
    const n = p.s.length;
    const wide = Math.min(DEFAULT_TRACK_TRAITS.widthMax, START_MIN_HALF_WIDTH + 2);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (inStartZone(u) || u <= 0.03 + 40 / 900) {
        expect(p.halfWidth[i]!).toBeGreaterThanOrEqual(wide - 1e-9);
      }
    }
  });

  it("is deterministic with curvature supplied", () => {
    const a = generateWidthProfile(7, 900, DEFAULT_TRACK_TRAITS, syntheticCurv());
    const b = generateWidthProfile(7, 900, DEFAULT_TRACK_TRAITS, syntheticCurv());
    expect(a).toEqual(b);
  });
});

describe("resolveTrackTraits", () => {
  it("defaults when no overrides (temperate parity)", () => {
    expect(resolveTrackTraits(undefined)).toEqual(DEFAULT_TRACK_TRAITS);
    expect(BIOMES["temperate"]!.track).toBeUndefined();
  });

  it("floors widthMax at 6 and orders the band", () => {
    const t = resolveTrackTraits({ widthMin: 7, widthMax: 5 });
    expect(t.widthMax).toBe(6);
    expect(t.widthMin).toBeLessThanOrEqual(t.widthMax);
  });

  it("clamps variation to [0,1] and branchChance to [0,2]", () => {
    const t = resolveTrackTraits({ widthVariation: 3, branchChance: 9 });
    expect(t.widthVariation).toBe(1);
    expect(t.branchChance).toBe(2);
  });
});
