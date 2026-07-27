import { describe, expect, it } from "vitest";
import { BIOMES } from "./registry";

describe("skyFogBias identity (only tropical biases light)", () => {
  it("temperate skyFogBias is undefined", () => {
    expect(BIOMES.temperate.skyFogBias).toBeUndefined();
  });

  it("alpine/tundra keep fogTint + skyTint only (no light/zenith/horizon/factor)", () => {
    for (const id of ["alpine", "tundra"] as const) {
      const bias = BIOMES[id].skyFogBias;
      expect(bias).toBeDefined();
      expect(bias!.fogTint).toBeGreaterThan(0);
      expect(bias!.skyTint).toBeGreaterThan(0);
      expect(bias!.sunTint).toBeUndefined();
      expect(bias!.ambientTint).toBeUndefined();
      expect(bias!.skyZenithTint).toBeUndefined();
      expect(bias!.skyHorizonTint).toBeUndefined();
      expect(bias!.factor).toBeUndefined();
    }
  });

  it("desert splits zenith/horizon (no shared skyTint, no light tints/factor)", () => {
    const bias = BIOMES.desert.skyFogBias;
    expect(bias).toBeDefined();
    expect(bias!.fogTint).toBeGreaterThan(0);
    expect(bias!.skyTint).toBeUndefined();
    // Horizon tracks the fog tint by contract (edge dissolves into the sky).
    expect(bias!.skyHorizonTint).toBe(bias!.fogTint);
    expect(bias!.skyZenithTint).toBeGreaterThan(0);
    expect(bias!.sunTint).toBeUndefined();
    expect(bias!.ambientTint).toBeUndefined();
    expect(bias!.factor).toBeUndefined();
  });
});
