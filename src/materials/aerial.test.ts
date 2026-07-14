import { describe, it, expect } from "vitest";
import { AERIAL_DEFAULTS, AERIAL_LUMA, applyAerial, smoothstep } from "./aerial";

describe("AERIAL_DEFAULTS", () => {
  it("ramp starts nearer than fog (90) and reaches full by the far plane", () => {
    expect(AERIAL_DEFAULTS.near).toBeGreaterThan(0);
    expect(AERIAL_DEFAULTS.near).toBeLessThan(90);
    expect(AERIAL_DEFAULTS.far).toBeGreaterThan(AERIAL_DEFAULTS.near);
  });

  it("desat/tint are restrained (< 1) so distance recedes, not washes flat", () => {
    expect(AERIAL_DEFAULTS.desat).toBeGreaterThan(0);
    expect(AERIAL_DEFAULTS.desat).toBeLessThan(1);
    expect(AERIAL_DEFAULTS.tint).toBeGreaterThan(0);
    expect(AERIAL_DEFAULTS.tint).toBeLessThan(1);
  });

  it("luma weights are Rec.709 and sum to 1 (match the GLSL dot)", () => {
    expect(AERIAL_LUMA).toEqual([0.2126, 0.7152, 0.0722]);
    expect(AERIAL_LUMA[0] + AERIAL_LUMA[1] + AERIAL_LUMA[2]).toBeCloseTo(1, 6);
  });
});

describe("smoothstep", () => {
  it("clamps below near to 0 and above far to 1", () => {
    expect(smoothstep(10, 20, 5)).toBe(0);
    expect(smoothstep(10, 20, 25)).toBe(1);
  });

  it("returns 0.5 at the midpoint (Hermite symmetry)", () => {
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 6);
  });

  it("degenerate near==far is a hard step", () => {
    expect(smoothstep(5, 5, 4)).toBe(0);
    expect(smoothstep(5, 5, 5)).toBe(1);
  });
});

describe("applyAerial", () => {
  const atmos: [number, number, number] = [0.6, 0.65, 0.7]; // cool blue-grey

  it("is identity at/under the near plane (foreground untouched)", () => {
    const c: [number, number, number] = [0.8, 0.2, 0.1];
    expect(applyAerial(c, AERIAL_DEFAULTS.near, atmos)).toEqual(c);
    expect(applyAerial(c, 0, atmos)).toEqual(c);
  });

  it("pulls a distant colour toward the atmosphere and desaturates it", () => {
    const c: [number, number, number] = [0.8, 0.2, 0.1]; // saturated warm
    const far = applyAerial(c, 10_000, atmos);
    // Desat pulls channels toward their shared luminance (spread shrinks);
    // tint pulls toward the cool atmosphere. Net: warmer red drops, blue rises.
    const spreadIn = Math.max(...c) - Math.min(...c);
    const spreadOut = Math.max(...far) - Math.min(...far);
    expect(spreadOut).toBeLessThan(spreadIn);
    expect(far[0]).toBeLessThan(c[0]);
    expect(far[2]).toBeGreaterThan(c[2]);
  });

  it("bit-mirrors the fragment math (desat toward lum, then tint)", () => {
    const c: [number, number, number] = [0.8, 0.2, 0.1];
    const depth = 200;
    const a = smoothstep(AERIAL_DEFAULTS.near, AERIAL_DEFAULTS.far, depth);
    const lum = c[0] * AERIAL_LUMA[0] + c[1] * AERIAL_LUMA[1] + c[2] * AERIAL_LUMA[2];
    const dk = a * AERIAL_DEFAULTS.desat;
    const d = c.map((ch) => ch + (lum - ch) * dk);
    const tk = a * AERIAL_DEFAULTS.tint;
    const expected = d.map((ch, i) => ch + (atmos[i] - ch) * tk);
    const got = applyAerial(c, depth, atmos);
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(expected[i], 10);
  });

  it("a neutral grey only shifts toward atmosphere (desat is a no-op)", () => {
    const grey: [number, number, number] = [0.5, 0.5, 0.5];
    const far = applyAerial(grey, 10_000, atmos);
    const a = smoothstep(AERIAL_DEFAULTS.near, AERIAL_DEFAULTS.far, 10_000);
    const tk = a * AERIAL_DEFAULTS.tint;
    for (let i = 0; i < 3; i++) {
      expect(far[i]).toBeCloseTo(0.5 + (atmos[i] - 0.5) * tk, 10);
    }
  });
});
