import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CLOUD_BASE_TINT,
  CLOUD_TINT_BLEND,
  FAR_BAND_TINT_BLEND,
  cloudTintFor,
  farBandTintFor,
} from "./cloudTint";

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

  it("all four phases handled: no throw, finite THREE.Color result", () => {
    const horizon = new THREE.Color(0xffd0a0);
    for (const phase of ["dawn", "day", "dusk", "night"] as const) {
      const res = cloudTintFor(phase, horizon, base, out);
      expect(res).toBeInstanceOf(THREE.Color);
      expect(Number.isFinite(res.r)).toBe(true);
      expect(Number.isFinite(res.g)).toBe(true);
      expect(Number.isFinite(res.b)).toBe(true);
    }
  });
});

describe("farBandTintFor", () => {
  const dist = (a: THREE.Color, b: THREE.Color): number =>
    Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

  it("blends toward the horizon by FAR_BAND_TINT_BLEND (not CLOUD_TINT_BLEND)", () => {
    const horizon = new THREE.Color(0xe8cf9a);
    farBandTintFor("day", horizon, base, out);
    const expected = base.clone().lerp(horizon, FAR_BAND_TINT_BLEND.day);
    expect(out.getHex()).toBe(expected.getHex());
  });

  it("day: shifts (unlike cloudTintFor which stays white) and lands nearer horizon", () => {
    const horizon = new THREE.Color(0xe8cf9a);
    const near = new THREE.Color();
    cloudTintFor("day", horizon, base, near); // == base (no day shift)
    farBandTintFor("day", horizon, base, out);
    expect(out.getHex()).not.toBe(near.getHex());
    expect(dist(out, horizon)).toBeLessThan(dist(near, horizon));
  });

  it("every phase blends harder toward the horizon than the near-puff tint", () => {
    const horizon = new THREE.Color(0xe8cf9a);
    for (const phase of ["dawn", "day", "dusk", "night"] as const) {
      expect(FAR_BAND_TINT_BLEND[phase]).toBeGreaterThan(CLOUD_TINT_BLEND[phase]);
      const nearC = new THREE.Color();
      const farC = new THREE.Color();
      cloudTintFor(phase, horizon, base, nearC);
      farBandTintFor(phase, horizon, base, farC);
      expect(dist(farC, horizon)).toBeLessThanOrEqual(dist(nearC, horizon));
    }
  });

  it("is pure: never mutates base or skyHorizon", () => {
    const horizon = new THREE.Color(0xe8cf9a);
    const baseC = new THREE.Color(CLOUD_BASE_TINT);
    const horizonBefore = horizon.getHex();
    const baseBefore = baseC.getHex();
    farBandTintFor("dusk", horizon, baseC, out);
    expect(horizon.getHex()).toBe(horizonBefore);
    expect(baseC.getHex()).toBe(baseBefore);
  });
});
