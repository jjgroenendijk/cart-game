import { describe, expect, it } from "vitest";
import {
  generateWidthProfile,
  inStartZone,
  START_MIN_HALF_WIDTH,
  WIDTH_SLOPE_MAX,
} from "./circuitWidth";
import { widthProfileAt } from "./trackGraph";
import { DEFAULT_TRACK_TRAITS, resolveTrackTraits } from "./trackTraits";
import { BIOMES } from "./biomes";

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
