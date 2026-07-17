import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SkyPosterizePass } from "./skyPosterize";
import { applySunEffects, type SunFxConfig } from "./sunEffects";

function makePass(): SkyPosterizePass {
  return new SkyPosterizePass(new THREE.DepthTexture(64, 48));
}

/** Camera at origin looking down -Z. */
function cam(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  c.updateMatrixWorld(true);
  return c;
}

const STRENGTHS = { halo: 0.4, godray: 0.5, flare: 0.6 };

function cfg(enables: Partial<SunFxConfig["enables"]> = {}): SunFxConfig {
  return {
    enables: { sunHalo: true, godRays: true, lensFlare: true, ...enables },
    strengths: STRENGTHS,
  };
}

describe("applySunEffects", () => {
  it("writes strength*glow gains for enabled effects + projects the sun uv", () => {
    const pass = makePass();
    applySunEffects(
      pass,
      cam(),
      new THREE.Vector3(0, 0, -1),
      1,
      new THREE.Color(1, 1, 1),
      0.5,
      cfg(),
    );
    expect(pass.haloIntensity).toBeCloseTo(0.4 * 0.5, 6);
    expect(pass.godrayIntensity).toBeCloseTo(0.5 * 0.5, 6);
    expect(pass.flareIntensity).toBeCloseTo(0.6 * 0.5, 6);
    // Dead-ahead sun -> in front, so effects are live.
    const u = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
    expect(u.uSunFront.value).toBe(1);
  });

  it("writes 0 gain for a disabled effect (identity for that term)", () => {
    const pass = makePass();
    applySunEffects(
      pass,
      cam(),
      new THREE.Vector3(0, 0, -1),
      1,
      new THREE.Color(1, 1, 1),
      0.5,
      cfg({ godRays: false }),
    );
    expect(pass.haloIntensity).toBeGreaterThan(0);
    expect(pass.godrayIntensity).toBe(0);
  });

  it("glow 0 (night) zeroes every gain even when all effects enabled", () => {
    const pass = makePass();
    applySunEffects(
      pass,
      cam(),
      new THREE.Vector3(0, 0, -1),
      1,
      new THREE.Color(1, 1, 1),
      0,
      cfg(),
    );
    expect(pass.haloIntensity).toBe(0);
    expect(pass.godrayIntensity).toBe(0);
    expect(pass.flareIntensity).toBe(0);
  });

  it("a sun behind the camera clears uSunFront (nothing draws)", () => {
    const pass = makePass();
    applySunEffects(pass, cam(), new THREE.Vector3(0, 0, 1), 1, new THREE.Color(1, 1, 1), 1, cfg());
    const u = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
    expect(u.uSunFront.value).toBe(0);
  });
});
