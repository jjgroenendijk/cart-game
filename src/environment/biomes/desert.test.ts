import { describe, expect, it } from "vitest";
import { BIOMES, biomeTerrain } from "./registry";
import { DEFAULT_TERRAIN_CONFIG } from "../../terrain/heightmap";

describe("desert biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.desert).toBeDefined();
    expect(BIOMES.desert.id).toBe("desert");
    expect(BIOMES.desert.label).toBe("Desert");
  });

  it("flora is the expected sparse per-chunk set", () => {
    expect(BIOMES.desert.flora).toEqual([
      { kind: "cactus", count: 2 },
      { kind: "sandRock", count: 2 },
      { kind: "mesaRock", count: 1 },
      { kind: "desertSnag", count: 1 },
      { kind: "yucca", count: 5 },
      { kind: "dryShrub", count: 22 },
      { kind: "barrelCactus", count: 6 },
      { kind: "desertBloom", count: 5 },
    ]);
  });

  it("flora has the big + decor kinds by name", () => {
    const kinds = new Set(BIOMES.desert.flora.map((f) => f.kind));
    const bigs = ["cactus", "sandRock"].filter((k) => kinds.has(k));
    const decors = ["yucca", "dryShrub"].filter((k) => kinds.has(k));
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather weights are clear/sandstorm/heatHaze", () => {
    expect(BIOMES.desert.weather).toEqual({
      clear: 0.85,
      sandstorm: 0.1,
      heatHaze: 0.05,
    });
  });

  it("waterLevel is far below the world (no water)", () => {
    expect(BIOMES.desert.waterLevel).toBe(-100);
  });

  it("skyFogBias: warm dust fog + horizon, cool zenith only", () => {
    // Fog and horizon MUST share the dust hue so the fully-fogged terrain
    // edge dissolves into the sky's horizon band instead of silhouetting
    // against a cool sky; the drained blue lives on the zenith alone.
    expect(BIOMES.desert.skyFogBias).toEqual({
      fogTint: 0xe8cf9a,
      skyZenithTint: 0x8fb6c8,
      skyHorizonTint: 0xe8cf9a,
    });
  });

  it('biomeTerrain("desert") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("desert");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(4);
    expect(cfg.noiseFreq).toBe(0.008);
    expect(cfg.sandLevel).toBe(3);
    expect(cfg.rockSlope).toBe(1.1);
    expect(cfg.colorRoad).toBe(0xb39b6e);
    expect(cfg.colorGrass).toBe(0xc2a14d);
    expect(cfg.colorSand).toBe(0xe3cf8e);
    expect(cfg.colorRock).toBe(0xb08d5a);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
