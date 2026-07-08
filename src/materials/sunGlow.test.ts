import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { glowIntensity, projectSunUv } from "./sunGlow";

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
}

describe("projectSunUv", () => {
  it("sun straight ahead (default cam looks -Z) -> uv center, visible", () => {
    const cam = makeCamera();
    const r = projectSunUv(new THREE.Vector3(0, 0, -1), cam);
    expect(r.visible).toBe(true);
    expect(r.uv.x).toBeCloseTo(0.5, 6);
    expect(r.uv.y).toBeCloseTo(0.5, 6);
  });

  it("sun off to one side -> uv off-center but in [0,1], visible", () => {
    const cam = makeCamera();
    const r = projectSunUv(new THREE.Vector3(0.3, 0, -1).normalize(), cam);
    expect(r.visible).toBe(true);
    expect(r.uv.x).toBeGreaterThan(0.5);
    expect(r.uv.x).toBeLessThanOrEqual(1);
    expect(r.uv.x).toBeGreaterThanOrEqual(0);
    expect(r.uv.y).toBeCloseTo(0.5, 6);
  });

  it("sun behind camera (+Z for default -Z cam) -> not visible, center default", () => {
    const cam = makeCamera();
    const r = projectSunUv(new THREE.Vector3(0, 0, 1), cam);
    expect(r.visible).toBe(false);
    expect(r.uv.x).toBeCloseTo(0.5, 6);
    expect(r.uv.y).toBeCloseTo(0.5, 6);
  });

  it("sun far off-screen to the side -> not visible", () => {
    const cam = makeCamera();
    const r = projectSunUv(new THREE.Vector3(1, 0, -1).normalize(), cam);
    expect(r.visible).toBe(false);
  });

  it("does not mutate the input sunDirWorld", () => {
    const cam = makeCamera();
    const sun = new THREE.Vector3(0.5, 0.2, -1).normalize();
    const before = sun.clone();
    projectSunUv(sun, cam);
    expect(sun.x).toBeCloseTo(before.x, 6);
    expect(sun.y).toBeCloseTo(before.y, 6);
    expect(sun.z).toBeCloseTo(before.z, 6);
  });

  it("returns a fresh object each call (no shared identity)", () => {
    const cam = makeCamera();
    const sun = new THREE.Vector3(0, 0, -1);
    const a = projectSunUv(sun, cam);
    const b = projectSunUv(sun, cam);
    expect(a).not.toBe(b);
    expect(a.uv).not.toBe(b.uv);
  });
});

describe("glowIntensity", () => {
  it("0 at full night (nightFactor = 1)", () => {
    expect(glowIntensity(5, 2.0, 1, 1)).toBeCloseTo(0, 6);
  });

  it("peaks at low elevation: glow(5) > glow(45)", () => {
    const low = glowIntensity(5, 2.0, 0, 1);
    const high = glowIntensity(45, 2.0, 0, 1);
    expect(low).toBeGreaterThan(high);
  });

  it("0 when sunIntensity = 0", () => {
    expect(glowIntensity(5, 0, 0, 1)).toBeCloseTo(0, 6);
  });

  it("0 when tierScale = 0", () => {
    expect(glowIntensity(5, 2.0, 0, 0)).toBeCloseTo(0, 6);
  });

  it("monotonically non-increasing as elevation rises 0..62", () => {
    let prev = Infinity;
    for (let e = 0; e <= 62; e += 2) {
      const g = glowIntensity(e, 2.0, 0, 1);
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
  });

  it("returns a value within [0,1] across an elevation sweep", () => {
    for (let e = -10; e <= 62; e += 4) {
      const g = glowIntensity(e, 1.5, 0.3, 0.8);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it("max at the horizon (elev 0, day, no night) ~= 1", () => {
    expect(glowIntensity(0, 2.0, 0, 1)).toBeCloseTo(1, 6);
  });

  it("below-horizon not hard-clipped while nightFactor < 1", () => {
    const g = glowIntensity(-3, 2.0, 0.2, 1);
    expect(g).toBeGreaterThan(0);
  });
});
