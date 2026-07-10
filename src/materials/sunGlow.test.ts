import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { effectGain, glowIntensity, projectSunUv } from "./sunGlow";

/** A camera at the origin looking down -Z (THREE default orientation). */
function cam(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  c.position.set(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
}

describe("projectSunUv", () => {
  it("puts a dead-ahead sun at screen center, front=true", () => {
    const s = projectSunUv(new THREE.Vector3(0, 0, -1), cam());
    expect(s.front).toBe(true);
    expect(s.u).toBeCloseTo(0.5, 3);
    expect(s.v).toBeCloseTo(0.5, 3);
  });

  it("flags a sun behind the camera as not front", () => {
    const s = projectSunUv(new THREE.Vector3(0, 0, 1), cam());
    expect(s.front).toBe(false);
  });

  it("moves the uv toward a screen edge as the sun swings off-axis", () => {
    const s = projectSunUv(new THREE.Vector3(0.6, 0, -1).normalize(), cam());
    expect(s.front).toBe(true);
    expect(s.u).toBeGreaterThan(0.5);
  });

  it("puts a sun above the view axis high on screen (v > 0.5)", () => {
    const s = projectSunUv(new THREE.Vector3(0, 0.6, -1).normalize(), cam());
    expect(s.v).toBeGreaterThan(0.5);
  });
});

describe("glowIntensity", () => {
  it("is 0 at night (nightFactor 1)", () => {
    expect(glowIntensity(-5, 1.5, 1)).toBe(0);
  });

  it("is 0 when the sun contributes no light", () => {
    expect(glowIntensity(5, 0, 0)).toBe(0);
  });

  it("peaks near the horizon and fades toward noon", () => {
    const low = glowIntensity(2, 2, 0);
    const high = glowIntensity(45, 2, 0);
    expect(low).toBeGreaterThan(high);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
  });

  it("stays within 0..1", () => {
    for (const e of [-10, 0, 10, 30, 62]) {
      const g = glowIntensity(e, 4, 0);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});

describe("effectGain", () => {
  it("is 0 when the effect is disabled regardless of glow", () => {
    expect(effectGain(1, false, 0.8)).toBe(0);
  });

  it("scales the tier strength by the day-phase glow when enabled", () => {
    expect(effectGain(0.5, true, 0.6)).toBeCloseTo(0.3, 6);
  });
});
