import { describe, expect, it } from "vitest";
import { BIOMES, biomeTerrain } from "./registry";
import { DEFAULT_TERRAIN_CONFIG } from "../../terrain/heightmap";

describe("alpine biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.alpine).toBeDefined();
    expect(BIOMES.alpine.id).toBe("alpine");
    expect(BIOMES.alpine.label).toBe("Alpine");
  });

  it("flora is the expected per-chunk mountain set", () => {
    expect(BIOMES.alpine.flora).toEqual([
      { kind: "alpinePine", count: 3 },
      { kind: "fir", count: 2 },
      { kind: "alpineSnag", count: 1 },
      { kind: "screeRock", count: 2 },
      { kind: "lichenBush", count: 20 },
      { kind: "alpineBloom", count: 8 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.alpine.flora.map((f) => f.kind));
    const bigs = ["alpinePine", "screeRock"].filter((k) => kinds.has(k));
    const decors = ["lichenBush"].filter((k) => kinds.has(k));
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather weights are clear/snow/blizzard", () => {
    expect(BIOMES.alpine.weather).toEqual({
      clear: 0.55,
      snow: 0.35,
      blizzard: 0.1,
    });
  });

  it("waterColor is the cold pale mountain-lake tint", () => {
    expect(BIOMES.alpine.waterColor).toBe(0xaec4cc);
  });

  it("waterLevel is low (mountain lakes in deep valleys)", () => {
    expect(BIOMES.alpine.waterLevel).toBe(-5);
  });

  it("skyFogBias tints fog + sky cold pale (thin air)", () => {
    expect(BIOMES.alpine.skyFogBias).toEqual({
      fogTint: 0xb8c4cc,
      skyTint: 0x4a6a8a,
    });
  });

  it('biomeTerrain("alpine") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("alpine");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(32);
    expect(cfg.noiseFreq).toBe(0.0055);
    expect(cfg.noiseOctaves).toBe(5);
    expect(cfg.rockSlope).toBe(0.55);
    expect(cfg.colorRoad).toBe(0x6e6256);
    expect(cfg.colorGrass).toBe(0x4f7a3a);
    expect(cfg.colorSand).toBe(0xc2b280);
    expect(cfg.colorRock).toBe(0x8a8a92);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandLevel).toBe(dflt.sandLevel);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
