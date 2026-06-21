import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SkyPosterizePass, posterizeChannel } from "./skyPosterize";

describe("posterizeChannel", () => {
  it("snaps a 0..1 gradient to bands+1 levels (floor(value*bands)/bands)", () => {
    // bands=4 -> levels {0, 0.25, 0.5, 0.75, 1.0} across 0..1
    const steps = [0, 0.1, 0.25, 0.4, 0.5, 0.7, 0.75, 0.99, 1.0].map((v) => posterizeChannel(v, 4));
    expect(steps).toEqual([0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1.0]);
  });

  it("matches cel.ts floor(NdL*bands)/bands convention", () => {
    // Same math, just on a generic channel value instead of NdL.
    expect(posterizeChannel(0.34, 3)).toBeCloseTo(1 / 3, 6);
    expect(posterizeChannel(0.67, 3)).toBeCloseTo(2 / 3, 6);
    expect(posterizeChannel(1.0, 3)).toBeCloseTo(1.0, 6);
  });
});

describe("SkyPosterizePass", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return { scene, camera, pass: new SkyPosterizePass(scene, camera, 64, 48) };
  }

  it("builds a non-sky depth RT with a DepthTexture attachment", () => {
    const { pass } = makePass();
    expect(pass.depthRT).toBeInstanceOf(THREE.WebGLRenderTarget);
    const dt = pass.depthRT.depthTexture;
    expect(dt).toBeInstanceOf(THREE.DepthTexture);
    expect(dt!.format).toBe(THREE.DepthFormat);
    expect(dt!.type).toBe(THREE.UnsignedIntType);
  });

  it("has a depth-only override material (no normal/color output)", () => {
    const { pass } = makePass();
    expect(pass.depthMaterial).toBeInstanceOf(THREE.ShaderMaterial);
    expect(pass.depthMaterial.fragmentShader).toContain("vec4(0.0, 0.0, 0.0, 1.0)");
  });

  it("default nonSkyLayersMask = layers 0+1 (sky on layer 2 masked in)", () => {
    const { pass } = makePass();
    expect(pass.nonSkyLayersMask).toBe(0b011);
  });

  it("default uSkyBands = 4 + uBandMix = 0.85 + uSkyStart = 0.5 with runtime getter/setters", () => {
    const { pass } = makePass();
    expect(pass.skyBands).toBe(4);
    expect(pass.bandMix).toBeCloseTo(0.85, 6);
    pass.skyBands = 5;
    pass.bandMix = 0.5;
    expect(pass.skyBands).toBe(5);
    expect(pass.bandMix).toBeCloseTo(0.5, 6);
  });

  it("default zenith/horizon tints match Ghibli palette", () => {
    const { pass } = makePass();
    const u = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
    expect((u.uSkyZenith.value as THREE.Color).getHex()).toBe(0x4a8fcf);
    expect((u.uSkyHorizon.value as THREE.Color).getHex()).toBe(0xfde8c0);
    expect(u.uSkyStart.value).toBeCloseTo(0.5, 6);
  });

  it("composites banding over readBuffer color, masked by non-sky depth", () => {
    const { pass } = makePass();
    const src = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material;
    const u = src.uniforms;
    expect(u.tColor).toBeDefined();
    expect(u.tDepth).toBeDefined();
    expect(u.uSkyBands.value).toBe(4);
    expect(u.uDepthEps.value).toBeCloseTo(1e-4, 10);
    expect(u.uBandMix.value).toBeCloseTo(0.85, 6);
    expect(u.uSkyStart.value).toBeCloseTo(0.5, 6);
    // GLSL masks sky via depth == 1.0 (cleared far plane).
    expect(src.fragmentShader).toContain("depth >= 1.0 - uDepthEps");
    // GLSL banding: remap visible-sky vUv.y to [0,1] then quantize + blend.
    expect(src.fragmentShader).toContain("(vUv.y - uSkyStart) / (1.0 - uSkyStart)");
    expect(src.fragmentShader).toContain("floor(t * uSkyBands)");
    expect(src.fragmentShader).toContain("mix(uSkyHorizon, uSkyZenith, band)");
    expect(src.fragmentShader).toContain("mix(color, synthetic, uBandMix)");
  });

  it("setSize resizes the depth RT", () => {
    const { pass } = makePass();
    pass.setSize(128, 96);
    expect(pass.depthRT.width).toBe(128);
    expect(pass.depthRT.height).toBe(96);
  });

  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });
});
