import { describe, expect, it } from "vitest";
import { BIOMES, MAX_BIG_PROPS_PER_CHUNK, type BiomeDefinition } from "./registry";
import { validateBiome, type ValidateCtx } from "./validate";

// Cross-layer imports are allowed in TEST files (not production deps). These
// register all shipped flora kinds as a side effect.
import "./temperate/flora";
import "./desert/flora";
import "./alpine/flora";
import "./tundra/flora";
import "./tropical/flora";
import "./autumn/flora";
import "./badlands/flora";
import "./beach/flora";
import "./mediterranean/flora";
import { floraFor, registeredFloraKinds } from "../floraRegistry";
import { WEATHER_PRESET_CONFIG } from "../weatherPresets";

const REGISTERED_KINDS = new Set(registeredFloraKinds());

/** Safe isBigKind: unknown kinds are not big (avoids floraFor throwing). */
const IS_BIG_KIND = (kind: string): boolean => {
  try {
    return floraFor(kind).big;
  } catch {
    return false;
  }
};

const KNOWN_WEATHER_KEYS = new Set<string>(["clear", ...Object.keys(WEATHER_PRESET_CONFIG)]);

/** Flat corridor + flat heightAt for the dynamic-green baseline. */
const FLAT_CORRIDOR: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [10, 0],
  [20, 0],
];
const FLAT_HEIGHT = (): number => 0;

/** A clean base def: passes every static + dynamic check under a valid ctx. */
const BASE_DEF: BiomeDefinition = {
  id: "testbase",
  label: "Test Base",
  terrain: {},
  flora: [{ kind: "tree", count: 1 }],
  weather: { clear: 1 },
};

function makeCtx(over: Partial<ValidateCtx> = {}): ValidateCtx {
  return {
    registeredKinds: REGISTERED_KINDS,
    isBigKind: IS_BIG_KIND,
    knownWeatherKeys: KNOWN_WEATHER_KEYS,
    bigPerChunkCap: MAX_BIG_PROPS_PER_CHUNK,
    heightAt: FLAT_HEIGHT,
    corridor: FLAT_CORRIDOR,
    ...over,
  };
}

function codes(def: BiomeDefinition, ctx: ValidateCtx = makeCtx()): string[] {
  return validateBiome(def, ctx).map((f) => f.code);
}

describe("validateBiome - green (shipped biomes clean)", () => {
  it("every shipped biome returns ZERO error-level findings under a valid ctx", () => {
    for (const def of Object.values(BIOMES)) {
      const errs = validateBiome(def, makeCtx()).filter((f) => f.level === "error");
      expect(errs, `biome ${def.id} had errors`).toEqual([]);
    }
  });
});

describe("validateBiome - red fixtures (one code each)", () => {
  it("FLORA_NEG: a negative count errors", () => {
    const def: BiomeDefinition = { ...BASE_DEF, flora: [{ kind: "tree", count: -1 }] };
    expect(codes(def)).toContain("FLORA_NEG");
    const f = validateBiome(def, makeCtx()).find((x) => x.code === "FLORA_NEG")!;
    expect(f.level).toBe("error");
  });

  it("FLORA_UNKNOWN: an unregistered kind errors", () => {
    const def: BiomeDefinition = { ...BASE_DEF, flora: [{ kind: "tre", count: 1 }] };
    expect(codes(def)).toContain("FLORA_UNKNOWN");
    expect(codes(def)).not.toContain("FLORA_COUNT");
  });

  it("FLORA_COUNT: big-prop sum over a small injected cap errors", () => {
    const def: BiomeDefinition = { ...BASE_DEF, flora: [{ kind: "tree", count: 1 }] };
    // Inject cap 0 so a single big prop trips it.
    const ctx = makeCtx({ bigPerChunkCap: 0 });
    expect(codes(def, ctx)).toContain("FLORA_COUNT");
  });

  it("WEATHER_NEG: a negative weight errors (without tripping WEATHER_SUM)", () => {
    const def: BiomeDefinition = { ...BASE_DEF, weather: { clear: 1, rain: -0.5 } };
    expect(codes(def)).toContain("WEATHER_NEG");
    expect(codes(def)).not.toContain("WEATHER_SUM");
  });

  it("WEATHER_UNKNOWN: a typoed preset key errors", () => {
    const def: BiomeDefinition = { ...BASE_DEF, weather: { clear: 1, typo: 0.5 } };
    expect(codes(def)).toContain("WEATHER_UNKNOWN");
    expect(codes(def)).not.toContain("WEATHER_SUM");
  });

  it("WEATHER_SUM: an all-zero/empty partition errors", () => {
    const def: BiomeDefinition = { ...BASE_DEF, weather: {} };
    expect(codes(def)).toContain("WEATHER_SUM");
    expect(codes(def)).not.toContain("WEATHER_UNKNOWN");
  });

  it("PALETTE_READABILITY: identical road+grass warns", () => {
    const def: BiomeDefinition = {
      ...BASE_DEF,
      terrain: { colorRoad: 0x6e6256, colorGrass: 0x6e6256 },
    };
    const palette = validateBiome(def, makeCtx()).find((x) => x.code === "PALETTE_READABILITY");
    expect(palette).toBeDefined();
    expect(palette!.level).toBe("warn");
  });

  it("DRIVE_GRADE: a cliff heightAt along the corridor errors", () => {
    // 5m vertical step between adjacent samples > STEP_DELTA_CAP (1.0).
    const cliff = (x: number): number => (x > 5 ? 5 : 0);
    const ctx = makeCtx({ heightAt: cliff });
    expect(codes(BASE_DEF, ctx)).toContain("DRIVE_GRADE");
    const f = validateBiome(BASE_DEF, ctx).find((x) => x.code === "DRIVE_GRADE")!;
    expect(f.level).toBe("error");
  });

  it("WATER_FLORA_SUNK: waterLevel above the sampled floor warns", () => {
    // Flat heightAt -> floor 0; waterLevel 5 -> floor below water.
    const def: BiomeDefinition = { ...BASE_DEF, waterLevel: 5 };
    const water = validateBiome(def, makeCtx()).find((x) => x.code === "WATER_FLORA_SUNK");
    expect(water).toBeDefined();
    expect(water!.level).toBe("warn");
  });
});

describe("validateBiome - dynamic checks skip without heightAt/corridor", () => {
  it("omitting heightAt + corridor yields no dynamic findings", () => {
    const ctx = makeCtx({ heightAt: undefined, corridor: undefined });
    const codesNoDyn = validateBiome(BASE_DEF, ctx).map((f) => f.code);
    expect(codesNoDyn).not.toContain("DRIVE_GRADE");
    expect(codesNoDyn).not.toContain("WATER_FLORA_SUNK");
  });
});
