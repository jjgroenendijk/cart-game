import { describe, expect, it } from "vitest";
import {
  KART_COLORWAYS,
  colorwayById,
  colorwayForRival,
  type KartColorwayId,
} from "./kartColorways";
import { KART_VARIANTS } from "./kartVariants";

describe("kartColorways (083)", () => {
  it("registers 8 colorways with unique ids and body/accent pairs", () => {
    expect(KART_COLORWAYS).toHaveLength(8);
    expect(new Set(KART_COLORWAYS.map((c) => c.id)).size).toBe(8);
    for (const c of KART_COLORWAYS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.colors.body).not.toBe(c.colors.accent);
    }
  });

  it("colorwayById round-trips every id and throws on unknown", () => {
    for (const c of KART_COLORWAYS) expect(colorwayById(c.id)).toBe(c);
    expect(() => colorwayById("nope" as KartColorwayId)).toThrow(/unknown colorway/);
  });

  it("every variant's stock colorway resolves and matches its legacy colors", () => {
    for (const v of KART_VARIANTS) {
      expect(colorwayById(v.colorway).colors).toEqual(v.colors);
    }
  });

  it("colorwayForRival is deterministic per (seed, index)", () => {
    for (let i = 0; i < 8; i++) {
      expect(colorwayForRival(1337, i)).toBe(colorwayForRival(1337, i));
    }
  });

  it("colorwayForRival varies paint across a rival field", () => {
    const ids = new Set(Array.from({ length: 16 }, (_, i) => colorwayForRival(1337, i)));
    expect(ids.size).toBeGreaterThan(2);
  });
});
