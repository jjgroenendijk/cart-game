import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "./heightmap";
import { BIOMES, biomeTerrain, resolveBiome, selectBiome, type BiomeDefinition } from "./biomes";

const EXPECTED_TEMPERATE_FLORA: ReadonlyArray<{ kind: string; count: number }> = [
  { kind: "tree", count: 120 },
  { kind: "rock", count: 80 },
  { kind: "bush", count: 200 },
  { kind: "flower", count: 1500 },
  { kind: "grass", count: 3000 },
];

const EXPECTED_TEMPERATE_WEATHER: Readonly<Record<string, number>> = {
  clear: 0.7,
  rain: 0.15,
  snow: 0.15,
};

describe("BIOMES registry", () => {
  it("contains exactly the temperate biome", () => {
    expect(Object.keys(BIOMES)).toEqual(["temperate"]);
  });

  it("temperate has all required fields with sensible values", () => {
    const t = BIOMES.temperate;
    expect(t.id).toBe("temperate");
    expect(typeof t.label).toBe("string");
    expect(t.label.length).toBeGreaterThan(0);
    expect(t.terrain).toEqual({});
    expect(Array.isArray(t.flora)).toBe(true);
    expect(typeof t.weather).toBe("object");
    expect(t.waterColor).toBeUndefined();
    expect(t.waterLevel).toBeUndefined();
    expect(t.skyFogBias).toBeUndefined();
    expect(t.wildlife).toBeUndefined();
  });

  it("temperate flora counts mirror DEFAULT_PROP_COUNTS", () => {
    expect(BIOMES.temperate.flora).toEqual(EXPECTED_TEMPERATE_FLORA);
  });

  it("temperate weather weights mirror selectWeatherPreset partition", () => {
    expect(BIOMES.temperate.weather).toEqual(EXPECTED_TEMPERATE_WEATHER);
  });
});

describe("biomeTerrain parity (bit-identical to defaults)", () => {
  it('biomeTerrain("temperate") deep-equals DEFAULT_TERRAIN_CONFIG', () => {
    const cfg = biomeTerrain("temperate");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseFreq).toBe(dflt.noiseFreq);
    expect(cfg.noiseAmp).toBe(dflt.noiseAmp);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandLevel).toBe(dflt.sandLevel);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockSlope).toBe(dflt.rockSlope);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
    expect(cfg.colorRoad).toBe(dflt.colorRoad);
    expect(cfg.colorGrass).toBe(dflt.colorGrass);
    expect(cfg.colorSand).toBe(dflt.colorSand);
    expect(cfg.colorRock).toBe(dflt.colorRock);
  });

  it("biomeTerrain(definition) with empty overrides also yields parity", () => {
    const def: BiomeDefinition = {
      id: "custom",
      label: "Custom",
      terrain: {},
      flora: [],
      weather: {},
    };
    expect(biomeTerrain(def)).toEqual(DEFAULT_TERRAIN_CONFIG);
  });

  it("override applies only the overridden field; every other field stays default", () => {
    const def: BiomeDefinition = {
      id: "grassy",
      label: "Grassy",
      terrain: { colorGrass: 0x112233 },
      flora: [],
      weather: {},
    };
    const cfg: TerrainConfig = biomeTerrain(def);
    expect(cfg.colorGrass).toBe(0x112233);
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseFreq).toBe(dflt.noiseFreq);
    expect(cfg.noiseAmp).toBe(dflt.noiseAmp);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandLevel).toBe(dflt.sandLevel);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockSlope).toBe(dflt.rockSlope);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
    expect(cfg.colorRoad).toBe(dflt.colorRoad);
    expect(cfg.colorSand).toBe(dflt.colorSand);
    expect(cfg.colorRock).toBe(dflt.colorRock);
  });
});

describe("resolveBiome", () => {
  it('returns temperate for "temperate"', () => {
    expect(resolveBiome("temperate")).toBe(BIOMES.temperate);
  });

  it("returns temperate for undefined id", () => {
    expect(resolveBiome(undefined)).toBe(BIOMES.temperate);
  });

  it("falls back to temperate for an unknown id (no throw)", () => {
    expect(() => resolveBiome("nonexistent")).not.toThrow();
    expect(resolveBiome("nonexistent")).toBe(BIOMES.temperate);
  });
});

describe("selectBiome", () => {
  it("is deterministic (same seed -> same biome)", () => {
    for (const seed of [0, 1, 42, 99, 200, 12345]) {
      expect(selectBiome(seed).id).toBe(selectBiome(seed).id);
    }
  });

  it("always returns a registered biome", () => {
    for (let seed = 0; seed < 300; seed++) {
      const def = selectBiome(seed);
      expect(BIOMES).toHaveProperty(def.id);
      expect(def).toBe(BIOMES[def.id as keyof typeof BIOMES]);
    }
  });

  it("always picks temperate while only temperate is registered", () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(selectBiome(seed).id).toBe("temperate");
    }
  });
});
