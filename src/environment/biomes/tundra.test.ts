import { describe, expect, it } from "vitest";
import { BIOMES, biomeTerrain } from "./registry";
import { DEFAULT_TERRAIN_CONFIG } from "../../terrain/heightmap";

describe("tundra biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.tundra).toBeDefined();
    expect(BIOMES.tundra.id).toBe("tundra");
    expect(BIOMES.tundra.label).toBe("Tundra");
  });

  it("flora is the expected sparse per-chunk frozen set", () => {
    expect(BIOMES.tundra.flora).toEqual([
      { kind: "pine", count: 3 },
      { kind: "deadSpruce", count: 1 },
      { kind: "iceRock", count: 2 },
      { kind: "erratic", count: 1 },
      { kind: "snowBush", count: 16 },
      { kind: "frostTuft", count: 10 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.tundra.flora.map((f) => f.kind));
    const bigs = ["pine", "iceRock"].filter((k) => kinds.has(k));
    const decors = ["snowBush"].filter((k) => kinds.has(k));
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather weights are clear/snow/blizzard", () => {
    expect(BIOMES.tundra.weather).toEqual({
      clear: 0.5,
      snow: 0.35,
      blizzard: 0.15,
    });
  });

  it("waterColor is the frozen pale tint", () => {
    expect(BIOMES.tundra.waterColor).toBe(0xb8d0d8);
  });

  it("waterLevel is low (frozen pools in drift pockets)", () => {
    expect(BIOMES.tundra.waterLevel).toBe(-4);
  });

  it("skyFogBias tints fog + sky cold pale", () => {
    expect(BIOMES.tundra.skyFogBias).toEqual({
      fogTint: 0xd8dde0,
      skyTint: 0xb8c4cc,
    });
  });

  it('biomeTerrain("tundra") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("tundra");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(3);
    expect(cfg.noiseFreq).toBe(0.014);
    expect(cfg.sandLevel).toBe(-1);
    expect(cfg.rockSlope).toBe(0.9);
    expect(cfg.colorRoad).toBe(0x8a8a8a);
    expect(cfg.colorGrass).toBe(0xd8e0d8);
    expect(cfg.colorSand).toBe(0xc2b280);
    expect(cfg.colorRock).toBe(0x9aa0a8);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
