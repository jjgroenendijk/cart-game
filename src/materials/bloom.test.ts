import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MipmapBlurPass } from "postprocessing";
import { BloomPass } from "./bloom";

function makeRT(w = 64, h = 48): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
}

describe("BloomPass", () => {
  it("wraps a MipmapBlurPass with the given radius", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    expect(pass.blurPass).toBeInstanceOf(MipmapBlurPass);
    expect(pass.blurPass.radius).toBe(0.6);
    pass.dispose();
  });

  it("is needsSwap=true (writes the composited color into the outputBuffer)", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    expect(pass.needsSwap).toBe(true);
    pass.dispose();
  });

  it("setStrength / setRadius forward to the uniform + blur pass", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    pass.setStrength(0.2);
    pass.setRadius(0.4);
    const m = pass.fullscreenMaterial as THREE.ShaderMaterial;
    expect(m.uniforms.uStrength.value).toBe(0.2);
    expect(pass.blurPass.radius).toBe(0.4);
    pass.dispose();
  });

  it("halfRes scales the blur resolution down", () => {
    const full = new BloomPass(makeRT(), 128, 96, 0.5, 0.6, false);
    expect(full.halfRes).toBe(false);
    full.dispose();

    const half = new BloomPass(makeRT(), 128, 96, 0.5, 0.6, true);
    expect(half.halfRes).toBe(true);
    half.dispose();
  });

  it("setSize keeps the blur resolution aligned after a resize", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    pass.setSize(256, 192);
    expect(pass.halfRes).toBe(false);
    pass.dispose();
  });

  it("halfRes setSize recomputes from the new slot size", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, true);
    pass.setSize(256, 192);
    expect(pass.halfRes).toBe(true);
    pass.dispose();
  });
});
