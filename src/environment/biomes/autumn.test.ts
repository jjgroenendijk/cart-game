import { describe, expect, it } from "vitest";
import { BIOMES, biomeTerrain } from "./registry";
import { DEFAULT_TERRAIN_CONFIG } from "../../terrain/heightmap";

describe("autumn biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.autumn).toBeDefined();
    expect(BIOMES.autumn.id).toBe("autumn");
    expect(BIOMES.autumn.label).toBe("Autumn Forest");
  });

  it("flora is the expected dense forest set", () => {
    expect(BIOMES.autumn.flora).toEqual([
      { kind: "autumnTree", count: 4 },
      { kind: "autumnOak", count: 2 },
      { kind: "mossRock", count: 2 },
      { kind: "mushroom", count: 8 },
      { kind: "fern", count: 12 },
      { kind: "leafLitter", count: 24 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.autumn.flora.map((f) => f.kind));
    const bigs = ["autumnTree", "autumnOak", "mossRock"].filter((k) => kinds.has(k));
    const decors = ["mushroom", "fern", "leafLitter"].filter((k) => kinds.has(k));
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather weights are clear/leafFall/fog", () => {
    expect(BIOMES.autumn.weather).toEqual({
      clear: 0.45,
      leafFall: 0.4,
      fog: 0.15,
    });
  });

  it("water tints are the cool desaturated stream set", () => {
    expect(BIOMES.autumn.waterColor).toBe(0x7a8a76);
    expect(BIOMES.autumn.waterShallow).toBe(0x9aa06a);
    expect(BIOMES.autumn.waterDeep).toBe(0x2a3830);
  });

  it("waterLevel is low (streams in wooded pockets)", () => {
    expect(BIOMES.autumn.waterLevel).toBe(-3);
  });

  it("skyFogBias tints fog + sky + light warm golden (gentle factor)", () => {
    expect(BIOMES.autumn.skyFogBias).toEqual({
      fogTint: 0xd8b884,
      skyHorizonTint: 0xe8c88a,
      skyZenithTint: 0x6a7aa8,
      sunTint: 0xffdca8,
      ambientTint: 0xf0d8b0,
      factor: 0.22,
    });
  });

  it('biomeTerrain("autumn") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("autumn");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(8);
    expect(cfg.noiseFreq).toBe(0.012);
    expect(cfg.colorRoad).toBe(0x7a5a3a);
    expect(cfg.colorGrass).toBe(0xb07a3a);
    expect(cfg.colorSand).toBe(0xa07a4a);
    expect(cfg.colorRock).toBe(0x6a6a3a);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandLevel).toBe(dflt.sandLevel);
    expect(cfg.rockSlope).toBe(dflt.rockSlope);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
