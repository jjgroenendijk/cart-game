import { describe, expect, it } from "vitest";
import { DEFAULT_TUNING } from "./KartController";
import {
  KART_VARIANTS,
  statBarsFor,
  variantById,
  variantForRival,
  type KartVariantId,
} from "./kartVariants";

const VARIANT_IDS = ["balanced", "speed", "grip", "heavy", "feather", "trail", "rally"] as const;

describe("KART_VARIANTS", () => {
  it("has all seven variants with unique ids and non-empty names", () => {
    expect(KART_VARIANTS).toHaveLength(7);
    const ids = KART_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(7);
    for (const v of KART_VARIANTS) {
      expect(VARIANT_IDS).toContain(v.id);
      expect(v.name.length).toBeGreaterThan(0);
    }
  });

  it("balanced equals DEFAULT_TUNING exactly (every field)", () => {
    expect(variantById("balanced").tuning).toEqual(DEFAULT_TUNING);
  });

  it("every variant has valid tuning (finite, positive where required)", () => {
    for (const v of KART_VARIANTS) {
      const t = v.tuning;
      for (const val of Object.values(t)) {
        expect(Number.isFinite(val)).toBe(true);
      }
      expect(t.mass).toBeGreaterThan(0);
      expect(t.engineForce).toBeGreaterThan(0);
      expect(t.maxSpeed).toBeGreaterThan(0);
      expect(t.grip).toBeGreaterThan(0);
    }
  });

  it("every variant has sane silhouette dims (finite and positive)", () => {
    for (const v of KART_VARIANTS) {
      const s = v.silhouette;
      for (const d of s.bodyDims) {
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThan(0);
      }
      expect(Number.isFinite(s.tireRadius)).toBe(true);
      expect(s.tireRadius).toBeGreaterThan(0);
      expect(Number.isFinite(s.noseZ)).toBe(true);
      expect(Number.isFinite(s.spoilerH)).toBe(true);
    }
  });
});

describe("statBarsFor", () => {
  it("returns values in [0,1] for every variant", () => {
    for (const v of KART_VARIANTS) {
      const bars = statBarsFor(v.tuning);
      for (const val of Object.values(bars)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives the fastest variant speed bar 1 and the slowest 0", () => {
    const sorted = [...KART_VARIANTS].sort((a, b) => a.tuning.maxSpeed - b.tuning.maxSpeed);
    const slow = statBarsFor(sorted[0]!.tuning);
    const fast = statBarsFor(sorted[sorted.length - 1]!.tuning);
    expect(fast.speed).toBe(1);
    expect(slow.speed).toBe(0);
  });

  it("gives the lightest variant mass bar 1 (inverted)", () => {
    const lightest = [...KART_VARIANTS].sort((a, b) => a.tuning.mass - b.tuning.mass)[0]!;
    expect(statBarsFor(lightest.tuning).mass).toBe(1);
  });
});

describe("variantForRival", () => {
  it("is deterministic: same seed+index yields the same id", () => {
    for (const seed of [0, 1, 42, 999, 0xdeadbeef]) {
      for (let i = 0; i < 8; i++) {
        expect(variantForRival(seed, i)).toBe(variantForRival(seed, i));
      }
    }
  });

  it("with incrementing index yields valid ids from the union", () => {
    for (let i = 0; i < 32; i++) {
      expect(VARIANT_IDS).toContain(variantForRival(7, i));
    }
  });
});

describe("variantById", () => {
  it("returns the matching variant for each id", () => {
    for (const id of VARIANT_IDS) {
      expect(variantById(id).id).toBe(id);
    }
  });

  it("throws on an unknown id", () => {
    expect(() => variantById("nope" as unknown as KartVariantId)).toThrow(/unknown variant/);
  });
});
