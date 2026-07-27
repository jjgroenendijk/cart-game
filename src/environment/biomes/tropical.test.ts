import { describe, expect, it } from "vitest";
import { BIOMES, biomeTerrain } from "./registry";
import { DEFAULT_TERRAIN_CONFIG } from "../../terrain/heightmap";

describe("tropical biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.tropical).toBeDefined();
    expect(BIOMES.tropical.id).toBe("tropical");
    expect(BIOMES.tropical.label).toBe("Tropical");
  });

  it("flora is the expected palm-forward golden-hour shore set", () => {
    expect(BIOMES.tropical.flora).toEqual([
      { kind: "palm", count: 4 },
      { kind: "kapok", count: 1 },
      { kind: "jungleRock", count: 2 },
      { kind: "fernShrub", count: 3 },
      { kind: "broadleaf", count: 5 },
      { kind: "tropicalFlower", count: 8 },
      { kind: "seaOats", count: 12 },
      { kind: "hibiscus", count: 4 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.tropical.flora.map((f) => f.kind));
    const bigs = ["palm", "jungleRock"].filter((k) => kinds.has(k));
    const decors = ["fernShrub", "tropicalFlower", "seaOats", "hibiscus"].filter((k) =>
      kinds.has(k),
    );
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather weights are clear/rain/warmRain", () => {
    expect(BIOMES.tropical.weather).toEqual({
      clear: 0.7,
      warmRain: 0.2,
      rain: 0.1,
    });
  });

  it("waterColor is the pale teal tint", () => {
    expect(BIOMES.tropical.waterColor).toBe(0x8fcfc0);
  });

  it("waterShallow + waterDeep set the teal->deep-blue gradient", () => {
    expect(BIOMES.tropical.waterShallow).toBe(0x2db8b8);
    expect(BIOMES.tropical.waterDeep).toBe(0x0a3a55);
  });

  it("waterLevel is shallow warm (low pockets)", () => {
    expect(BIOMES.tropical.waterLevel).toBe(-2);
  });

  it("skyFogBias tints fog + sky + light warm (golden-hour lean)", () => {
    expect(BIOMES.tropical.skyFogBias).toEqual({
      fogTint: 0xffb488,
      skyHorizonTint: 0xffc78a,
      skyZenithTint: 0x3a5aa8,
      sunTint: 0xffd0a0,
      ambientTint: 0xffd9b0,
      factor: 0.28,
    });
  });

  it('biomeTerrain("tropical") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("tropical");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(8);
    expect(cfg.noiseFreq).toBe(0.014);
    expect(cfg.sandLevel).toBe(2);
    expect(cfg.rockSlope).toBe(1.1);
    expect(cfg.colorRoad).toBe(0x9a8258);
    expect(cfg.colorGrass).toBe(0x8fae5a);
    expect(cfg.colorSand).toBe(0xe8c896);
    expect(cfg.colorRock).toBe(0x9a7a55);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
