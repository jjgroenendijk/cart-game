import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_CONFIG } from "../../../terrain/heightmap";
import { BIOMES, biomeTerrain } from "../registry";

/**
 * Beach biome definition tests. Kept in the beach dir (like flora.test.ts) so
 * the shared registry.test.ts stays under the 600-line cap; the registry suite
 * still pins Object.keys(BIOMES)/BIOME_ORDER and runs validateBiome for beach.
 */
describe("beach biome", () => {
  it("is registered with id + label", () => {
    expect(BIOMES.beach).toBeDefined();
    expect(BIOMES.beach.id).toBe("beach");
    expect(BIOMES.beach.label).toBe("Beach");
  });

  it("flora is the expected bright-shore set", () => {
    expect(BIOMES.beach.flora).toEqual([
      { kind: "palm", count: 3 },
      { kind: "driftwood", count: 2 },
      { kind: "seaRock", count: 2 },
      { kind: "duneGrass", count: 16 },
      { kind: "shell", count: 8 },
    ]);
  });

  it("flora has >=2 big + >=1 decor kinds by name", () => {
    const kinds = new Set(BIOMES.beach.flora.map((f) => f.kind));
    const bigs = ["palm", "driftwood", "seaRock"].filter((k) => kinds.has(k));
    const decors = ["duneGrass", "shell"].filter((k) => kinds.has(k));
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(decors.length).toBeGreaterThanOrEqual(1);
  });

  it("weather weights are clear/warmRain/fog", () => {
    expect(BIOMES.beach.weather).toEqual({
      clear: 0.78,
      warmRain: 0.12,
      fog: 0.1,
    });
  });

  it("waterColor is the pale turquoise surface tint", () => {
    expect(BIOMES.beach.waterColor).toBe(0x9ad8d0);
  });

  it("waterShallow + waterDeep set the turquoise->deep-ocean gradient", () => {
    expect(BIOMES.beach.waterShallow).toBe(0x1fb6c8);
    expect(BIOMES.beach.waterDeep).toBe(0x06304a);
  });

  it("waterLevel keeps the road on land (broad ocean beyond the dunes)", () => {
    expect(BIOMES.beach.waterLevel).toBe(-2);
  });

  it("skyFogBias tints fog + sky + light bright midday (pale sea haze)", () => {
    expect(BIOMES.beach.skyFogBias).toEqual({
      fogTint: 0xdfeaf0,
      skyHorizonTint: 0xcfe6ec,
      skyZenithTint: 0x4a86c8,
      sunTint: 0xfff0d8,
      ambientTint: 0xdfe8ec,
      factor: 0.22,
    });
  });

  it('biomeTerrain("beach") overrides listed fields, keeps the rest default', () => {
    const cfg = biomeTerrain("beach");
    const dflt = DEFAULT_TERRAIN_CONFIG;
    expect(cfg.noiseAmp).toBe(4);
    expect(cfg.noiseFreq).toBe(0.01);
    expect(cfg.sandLevel).toBe(3);
    expect(cfg.rockSlope).toBe(1.2);
    expect(cfg.colorRoad).toBe(0xbfa878);
    expect(cfg.colorGrass).toBe(0x9caa66);
    expect(cfg.colorSand).toBe(0xe8dcc0);
    expect(cfg.colorRock).toBe(0x9a8f7e);
    expect(cfg.trackHalfWidth).toBe(dflt.trackHalfWidth);
    expect(cfg.blendWidth).toBe(dflt.blendWidth);
    expect(cfg.noiseOctaves).toBe(dflt.noiseOctaves);
    expect(cfg.noiseSeed).toBe(dflt.noiseSeed);
    expect(cfg.sandBlendHeight).toBe(dflt.sandBlendHeight);
    expect(cfg.rockBlendSlope).toBe(dflt.rockBlendSlope);
  });
});
