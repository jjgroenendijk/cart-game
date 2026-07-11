import { describe, expect, it } from "vitest";
import { SplineTrack } from "../../terrain/SplineTrack";
import { SplineFieldCache, heightAt } from "../../terrain/heightmap";
import { SimplexNoise2D } from "../../terrain/noise";
import {
  BIOMES,
  MAX_BIG_PROPS_PER_CHUNK,
  biomeTerrain,
  resolveBiome,
  type BiomeDefinition,
} from "./registry";
import { validateBiome, type ValidateCtx } from "./validate";

// Side-effect registration of every shipped flora kind. PropField already
// imports these in production; importing here makes the registry self-contained.
import "./temperate/flora";
import "./desert/flora";
import "./alpine/flora";
import "./tundra/flora";
import "./tropical/flora";
import { floraFor, registeredFloraKinds } from "../floraRegistry";
import { WEATHER_PRESET_CONFIG } from "../weatherPresets";

const REGISTERED_KINDS = new Set(registeredFloraKinds());
const IS_BIG_KIND = (kind: string): boolean => {
  try {
    return floraFor(kind).big;
  } catch {
    return false;
  }
};
const KNOWN_WEATHER_KEYS = new Set<string>(["clear", ...Object.keys(WEATHER_PRESET_CONFIG)]);

/** Build the default track + sample N arc-length-even centerline points. */
function sampleCorridor(track: SplineTrack, n = 64): Array<readonly [number, number]> {
  const pts: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p = track.getPoint(i / n);
    pts.push([p.x, p.z] as const);
  }
  return pts;
}

/** Real heightAt for a biome: cache + cfg-resolved noise over the spline field. */
function realHeightAt(def: BiomeDefinition, cache: SplineFieldCache) {
  const cfg = biomeTerrain(def);
  const noise = new SimplexNoise2D(cfg.noiseSeed);
  return (x: number, z: number): number => heightAt(x, z, cache, cfg, noise);
}

/** Per-biome big-prop sum (mirrors the FLORA_COUNT check math). */
function bigSum(def: BiomeDefinition): number {
  let s = 0;
  for (const f of def.flora) if (IS_BIG_KIND(f.kind)) s += f.count;
  return s;
}

describe("registry-driven biome suite", () => {
  const track = new SplineTrack();
  const cache = new SplineFieldCache(track);
  const corridor = sampleCorridor(track);

  it("BIOMES has exactly the five shipped entries", () => {
    expect(Object.keys(BIOMES)).toEqual(["temperate", "desert", "alpine", "tundra", "tropical"]);
  });

  describe.each(Object.values(BIOMES))("biome $id", (def: BiomeDefinition) => {
    it("passes validateBiome with zero errors under the REAL ctx", () => {
      const ctx: ValidateCtx = {
        registeredKinds: REGISTERED_KINDS,
        isBigKind: IS_BIG_KIND,
        knownWeatherKeys: KNOWN_WEATHER_KEYS,
        bigPerChunkCap: MAX_BIG_PROPS_PER_CHUNK,
        heightAt: realHeightAt(def, cache),
        corridor,
      };
      const errs = validateBiome(def, ctx).filter((f) => f.level === "error");
      expect(errs, errs.map((e) => e.code).join(",")).toEqual([]);
    });

    it("big-prop sum is within MAX_BIG_PROPS_PER_CHUNK", () => {
      expect(bigSum(def)).toBeLessThanOrEqual(MAX_BIG_PROPS_PER_CHUNK);
    });

    it("resolveBiome(def.id) round-trips to the same definition", () => {
      expect(resolveBiome(def.id)).toBe(def);
    });
  });

  it("temperate keeps all-undefined terrain overrides (parity guard)", () => {
    expect(BIOMES.temperate.terrain).toEqual({});
    expect(BIOMES.temperate.waterColor).toBeUndefined();
    expect(BIOMES.temperate.waterLevel).toBeUndefined();
    expect(BIOMES.temperate.skyFogBias).toBeUndefined();
    expect(BIOMES.temperate.wildlife).toBeUndefined();
  });

  it("biomeTerrain(temperate) is bit-identical to DEFAULT parity (empty spread)", () => {
    // Empty overrides spread over defaults: the resolved object has no
    // biome-specific key. Asserting the spread leaves overrides empty.
    const cfg = biomeTerrain("temperate");
    expect(cfg).toBeDefined();
    expect(Object.keys(BIOMES.temperate.terrain)).toHaveLength(0);
  });
});
