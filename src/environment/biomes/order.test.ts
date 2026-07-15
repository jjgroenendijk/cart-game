import { describe, expect, it } from "vitest";
import { BIOME_ORDER, BIOMES, biomeByIndex, biomeIndexOf } from "./registry";

describe("BIOME_ORDER", () => {
  it("is the exact frozen append-only list", () => {
    expect(BIOME_ORDER).toEqual(["temperate", "desert", "alpine", "tundra", "tropical", "autumn"]);
  });

  it("stays in sync with BIOMES keys (append in both or neither)", () => {
    expect([...BIOME_ORDER]).toEqual(Object.keys(BIOMES));
    for (const id of BIOME_ORDER) {
      expect(BIOMES[id]).toBeDefined();
    }
  });
});

describe("biomeByIndex", () => {
  it("returns temperate at index 0", () => {
    expect(biomeByIndex(0).id).toBe("temperate");
  });

  it("resolves every registered index to its BIOME_ORDER biome", () => {
    for (let i = 0; i < BIOME_ORDER.length; i++) {
      expect(biomeByIndex(i).id).toBe(BIOME_ORDER[i]);
      expect(biomeByIndex(i)).toBe(BIOMES[BIOME_ORDER[i]!]);
    }
  });

  it("degrades to temperate for out-of-range / NaN / non-integer", () => {
    expect(biomeByIndex(-1).id).toBe("temperate");
    expect(biomeByIndex(999).id).toBe("temperate");
    expect(biomeByIndex(NaN).id).toBe("temperate");
    expect(biomeByIndex(1.5).id).toBe("temperate");
  });
});

describe("biomeIndexOf", () => {
  it("returns the stable index for each registered biome", () => {
    expect(biomeIndexOf("temperate")).toBe(0);
    expect(biomeIndexOf("desert")).toBe(1);
    expect(biomeIndexOf("alpine")).toBe(2);
    expect(biomeIndexOf("tundra")).toBe(3);
    expect(biomeIndexOf("tropical")).toBe(4);
    expect(biomeIndexOf("autumn")).toBe(5);
  });

  it("degrades to 0 (temperate) for unknown ids", () => {
    expect(biomeIndexOf("nope")).toBe(0);
    expect(biomeIndexOf("")).toBe(0);
  });

  it("round-trips with biomeByIndex for every registered biome", () => {
    for (const id of Object.keys(BIOMES)) {
      expect(biomeByIndex(biomeIndexOf(id)).id).toBe(id);
    }
  });
});
