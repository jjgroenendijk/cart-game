import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_CONFIG } from "../../../terrain/heightmap";
import { BIOMES, biomeTerrain } from "../registry";

/**
 * Mediterranean biome definition tests. Kept in the mediterranean dir (like
 * beach/biome.test.ts) so the shared registry.test.ts stays under the 600-line
 * cap; the registry suite still pins Object.keys(BIOMES)/BIOME_ORDER and runs
 * validateBiome for mediterranean.
 */
describe("mediterranean biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.mediterranean).toBeDefined();
    expect(BIOMES.mediterranean.id).toBe("mediterranean");
    expect(BIOMES.mediterranean.label).toBe("Golden Hills");
  });

  it("flora is the expected vineyard-hills set", () => {
    expect(BIOMES.mediterranean.flora).toEqual([
      { kind: "cypress", count: 3 },
      { kind: "poplar", count: 2 },
      { kind: "oliveRock", count: 2 },
      { kind: "vineRow", count: 10 },
      { kind: "lavender", count: 18 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.mediterranean.flora.map((f) => f.kind));
    const bigs = ["cypress", "poplar", "oliveRock"].filter((k) => kinds.has(k));
    const decors = ["vineRow", "lavender"].filter((k) => kinds.has(k));
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather is clear-heavy with warm haze + rare warm rain", () => {
    expect(BIOMES.mediterranean.weather).toEqual({
      clear: 0.75,
      heatHaze: 0.15,
      warmRain: 0.1,
    });
  });

  it("water tints read as a warm shallow stream", () => {
    expect(BIOMES.mediterranean.waterColor).toBe(0x8fbfae);
    expect(BIOMES.mediterranean.waterShallow).toBe(0x5fae9a);
    expect(BIOMES.mediterranean.waterDeep).toBe(0x1c4a44);
  });

  it("waterLevel sits below sandLevel so only gullies fill", () => {
    expect(BIOMES.mediterranean.waterLevel).toBe(-6);
    expect(BIOMES.mediterranean.waterLevel!).toBeLessThan(BIOMES.mediterranean.terrain.sandLevel!);
  });

  it("skyFogBias is the warm golden register", () => {
    expect(BIOMES.mediterranean.skyFogBias).toEqual({
      fogTint: 0xc9a465,
      skyHorizonTint: 0xf0d9a4,
      skyZenithTint: 0x2f6ec2,
      sunTint: 0xffeccb,
      ambientTint: 0xd9c9a8,
      factor: 0.3,
    });
  });

  it("track rolls over the hills (elevation + hill bias, flow-favoured)", () => {
    const track = BIOMES.mediterranean.track!;
    expect(track.elevationScale).toBe(1.15);
    expect(track.hillBias).toBe(0.4);
    expect(track.branchBias).toBe("scenic");
    expect(track.archetypeWeights).toEqual({
      classic: 1.2,
      flow: 2,
      technical: 0.8,
      power: 1,
    });
  });

  it('biomeTerrain("mediterranean") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("mediterranean");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(9);
    expect(cfg.noiseFreq).toBe(0.007);
    expect(cfg.sandLevel).toBe(-5);
    expect(cfg.rockSlope).toBe(1.05);
    expect(cfg.colorRoad).toBe(0x54452f);
    expect(cfg.colorGrass).toBe(0x8a7b2e);
    expect(cfg.colorSand).toBe(0xbfa876);
    expect(cfg.colorRock).toBe(0x857a60);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
