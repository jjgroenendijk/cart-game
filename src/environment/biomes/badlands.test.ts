import { describe, expect, it } from "vitest";
import { BIOMES, biomeTerrain } from "./registry";

describe("badlands biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.badlands).toBeDefined();
    expect(BIOMES.badlands.id).toBe("badlands");
    expect(BIOMES.badlands.label).toBe("Badlands");
  });

  it("flora is the expected sparse red-rock canyon set", () => {
    expect(BIOMES.badlands.flora).toEqual([
      { kind: "juniper", count: 2 },
      { kind: "butteRock", count: 3 },
      { kind: "scrubBrush", count: 20 },
      { kind: "dryTuft", count: 14 },
    ]);
  });

  it("weather weights are clear/sandstorm/heatHaze; dry arroyo has no water", () => {
    expect(BIOMES.badlands.weather).toEqual({ clear: 0.8, sandstorm: 0.15, heatHaze: 0.05 });
    expect(BIOMES.badlands.waterLevel).toBe(-100);
  });

  it("skyFogBias: warm dust fog + horizon share the hue, cool zenith only", () => {
    expect(BIOMES.badlands.skyFogBias).toEqual({
      fogTint: 0xd8a878,
      skyHorizonTint: 0xd88a5a,
      skyZenithTint: 0x8fa8c0,
    });
  });

  it('biomeTerrain("badlands") applies the red-rock canyon overrides', () => {
    const cfg = biomeTerrain("badlands");
    expect(cfg.noiseAmp).toBe(16);
    expect(cfg.noiseFreq).toBe(0.009);
    expect(cfg.noiseOctaves).toBe(4);
    expect(cfg.rockSlope).toBe(0.5);
    expect(cfg.sandLevel).toBe(-2);
    expect(cfg.colorRoad).toBe(0x8a5a3e);
    expect(cfg.colorGrass).toBe(0x9c7a4a);
    expect(cfg.colorSand).toBe(0xd8a878);
    expect(cfg.colorRock).toBe(0xa0442c);
  });
});
