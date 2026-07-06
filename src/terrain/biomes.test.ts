import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from "./heightmap";
import { BIOMES, biomeTerrain, resolveBiome, selectBiome, type BiomeDefinition } from "./biomes";

const EXPECTED_TEMPERATE_FLORA: ReadonlyArray<{ kind: string; count: number }> = [
  { kind: "tree", count: 2 },
  { kind: "rock", count: 1 },
  { kind: "bush", count: 3 },
  { kind: "flower", count: 23 },
  { kind: "grass", count: 47 },
];

const EXPECTED_TEMPERATE_WEATHER: Readonly<Record<string, number>> = {
  clear: 0.7,
  rain: 0.15,
  snow: 0.15,
};

describe("BIOMES registry", () => {
  it("contains temperate + desert + alpine + tundra + tropical", () => {
    expect(Object.keys(BIOMES)).toEqual(["temperate", "desert", "alpine", "tundra", "tropical"]);
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
    expect(t.waterShallow).toBeUndefined();
    expect(t.waterDeep).toBeUndefined();
    expect(t.skyFogBias).toBeUndefined();
    expect(t.wildlife).toBeUndefined();
  });

  it("temperate flora counts mirror DEFAULT_DRESSING_COUNTS (per-chunk)", () => {
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

  it("reaches every registered biome over enough seeds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) seen.add(selectBiome(seed).id);
    for (const id of Object.keys(BIOMES)) expect(seen.has(id)).toBe(true);
  });
});

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
      { kind: "yucca", count: 5 },
      { kind: "dryShrub", count: 30 },
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

  it("skyFogBias tints fog + sky warm pale", () => {
    expect(BIOMES.desert.skyFogBias).toEqual({
      fogTint: 0xe8cf9a,
      skyTint: 0x8fb6c8,
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

describe("alpine biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.alpine).toBeDefined();
    expect(BIOMES.alpine.id).toBe("alpine");
    expect(BIOMES.alpine.label).toBe("Alpine");
  });

  it("flora is the expected per-chunk mountain set", () => {
    expect(BIOMES.alpine.flora).toEqual([
      { kind: "alpinePine", count: 3 },
      { kind: "screeRock", count: 2 },
      { kind: "lichenBush", count: 25 },
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

describe("tundra biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.tundra).toBeDefined();
    expect(BIOMES.tundra.id).toBe("tundra");
    expect(BIOMES.tundra.label).toBe("Tundra");
  });

  it("flora is the expected sparse per-chunk frozen set", () => {
    expect(BIOMES.tundra.flora).toEqual([
      { kind: "pine", count: 3 },
      { kind: "iceRock", count: 2 },
      { kind: "snowBush", count: 20 },
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

describe("tropical biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.tropical).toBeDefined();
    expect(BIOMES.tropical.id).toBe("tropical");
    expect(BIOMES.tropical.label).toBe("Tropical");
  });

  it("flora is the expected dense per-chunk jungle set", () => {
    expect(BIOMES.tropical.flora).toEqual([
      { kind: "palm", count: 2 },
      { kind: "jungleRock", count: 2 },
      { kind: "fernShrub", count: 5 },
      { kind: "tropicalFlower", count: 8 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.tropical.flora.map((f) => f.kind));
    const bigs = ["palm", "jungleRock"].filter((k) => kinds.has(k));
    const decors = ["fernShrub", "tropicalFlower"].filter((k) => kinds.has(k));
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

  it("skyFogBias tints fog warm greenish haze + sky deep blue", () => {
    expect(BIOMES.tropical.skyFogBias).toEqual({
      fogTint: 0xb8c8a0,
      skyTint: 0x3a7ad8,
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
