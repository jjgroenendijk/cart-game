import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BloomPass } from "./bloom";

function makeRT(w = 64, h = 48): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
}

describe("BloomPass", () => {
  it("wraps an UnrealBloomPass with threshold 0 (emissive RT is emitter-only)", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    expect(pass.unreal).toBeInstanceOf(UnrealBloomPass);
    expect(pass.unreal.threshold).toBe(0);
    expect(pass.unreal.strength).toBe(0.5);
    expect(pass.unreal.radius).toBe(0.6);
    pass.dispose();
  });

  it("is needsSwap=true (writes the composited color into the writeBuffer)", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    expect(pass.needsSwap).toBe(true);
    pass.dispose();
  });

  it("setStrength / setRadius forward to the wrapped UnrealBloomPass", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    pass.setStrength(0.2);
    pass.setRadius(0.4);
    expect(pass.unreal.strength).toBe(0.2);
    expect(pass.unreal.radius).toBe(0.4);
    pass.dispose();
  });

  it("full-resolution by default; halfRes scales the blur resolution down", () => {
    const full = new BloomPass(makeRT(), 128, 96, 0.5, 0.6, false);
    // UnrealBloomPass sizes its internal bright RT at resolution/2.
    expect(full.unreal.renderTargetBright.width).toBe(64);
    full.dispose();

    const half = new BloomPass(makeRT(), 128, 96, 0.5, 0.6, true);
    // halfRes -> blur runs at 128/2=64, then UnrealBloomPass halves again -> 32.
    expect(half.unreal.renderTargetBright.width).toBe(32);
    half.dispose();
  });

  it("setSize keeps the blur resolution aligned after a resize", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, false);
    pass.setSize(256, 192);
    expect(pass.unreal.renderTargetBright.width).toBe(128);
    pass.dispose();
  });

  it("halfRes setSize recomputes from the new slot size", () => {
    const pass = new BloomPass(makeRT(), 64, 48, 0.5, 0.6, true);
    pass.setSize(256, 192); // halfRes -> 128, then UnrealBloomPass halves -> 64
    expect(pass.unreal.renderTargetBright.width).toBe(64);
    pass.dispose();
  });
});
