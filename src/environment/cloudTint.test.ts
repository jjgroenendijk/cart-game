import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CLOUD_BASE_TINT, CLOUD_TINT_BLEND, cloudTintFor } from "./cloudTint";

const base = new THREE.Color(CLOUD_BASE_TINT);
const out = new THREE.Color();

describe("cloudTintFor", () => {
  it("day phase: output equals base (no shift)", () => {
    const horizon = new THREE.Color(0xfde8c0);
    cloudTintFor("day", horizon, base, out);
    expect(out.getHex()).toBe(base.getHex());
  });

  it("dawn phase: output is the base lerp toward the warm horizon tint", () => {
    const horizon = new THREE.Color(0xffd0a0);
    cloudTintFor("dawn", horizon, base, out);
    const expected = base.clone().lerp(horizon, CLOUD_TINT_BLEND.dawn);
    expect(out.getHex()).toBe(expected.getHex());
    expect(out.getHex()).not.toBe(base.getHex());
  });

  it("dusk phase: output is the base lerp toward the amber horizon tint", () => {
    const horizon = new THREE.Color(0xff8050);
    cloudTintFor("dusk", horizon, base, out);
    const expected = base.clone().lerp(horizon, CLOUD_TINT_BLEND.dusk);
    expect(out.getHex()).toBe(expected.getHex());
    // dawn vs dusk horizons yield distinct cloud tints.
    const dawnOut = new THREE.Color();
    cloudTintFor("dawn", new THREE.Color(0xffd0a0), base, dawnOut);
    expect(out.getHex()).not.toBe(dawnOut.getHex());
  });

  it("night phase: output darkens toward the night horizon tint", () => {
    const horizon = new THREE.Color(0x1a2035);
    cloudTintFor("night", horizon, base, out);
    const expected = base.clone().lerp(horizon, CLOUD_TINT_BLEND.night);
    expect(out.getHex()).toBe(expected.getHex());
    const darker = out.r + out.g + out.b < base.r + base.g + base.b;
    expect(darker).toBe(true);
  });

  it("is pure: never mutates base or skyHorizon", () => {
    const horizon = new THREE.Color(0xff8050);
    const baseC = new THREE.Color(CLOUD_BASE_TINT);
    const horizonBefore = horizon.getHex();
    const baseBefore = baseC.getHex();
    cloudTintFor("dusk", horizon, baseC, out);
    expect(horizon.getHex()).toBe(horizonBefore);
    expect(baseC.getHex()).toBe(baseBefore);
  });

  it("is deterministic: same inputs -> identical output across calls", () => {
    const horizon = new THREE.Color(0xffd0a0);
    const a = new THREE.Color();
    const b = new THREE.Color();
    cloudTintFor("dawn", horizon, base, a);
    cloudTintFor("dawn", horizon, base, b);
    expect(a.getHex()).toBe(b.getHex());
  });
});
