import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PostOutlinePass } from "./postOutline";

describe("PostOutlinePass", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1); // mimic the Renderer enabling the terrain layer
    return { scene, camera, pass: new PostOutlinePass(scene, camera, 64, 48) };
  }

  it("builds a normal+depth render target with a DepthTexture attachment", () => {
    const { pass } = makePass();
    expect(pass.normalDepthRT).toBeInstanceOf(THREE.WebGLRenderTarget);
    const dt = pass.normalDepthRT.depthTexture;
    expect(dt).toBeInstanceOf(THREE.DepthTexture);
    expect(dt!.format).toBe(THREE.DepthFormat);
    expect(dt!.type).toBe(THREE.UnsignedIntType);
  });

  it("has a terrain-normal override material that outputs packed view normals", () => {
    const { pass } = makePass();
    expect(pass.normalMaterial).toBeInstanceOf(THREE.ShaderMaterial);
    expect(pass.normalMaterial.vertexShader).toContain("normalMatrix * normal");
    expect(pass.normalMaterial.fragmentShader).toContain("vN * 0.5 + 0.5");
  });

  it("composites Sobel edges from readBuffer color + terrain normal/depth", () => {
    const { pass } = makePass();
    const src = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material;
    const u = src.uniforms;
    expect(u.tColor).toBeDefined();
    expect(u.tNormal).toBeDefined();
    expect(u.tDepth).toBeDefined();
    expect(u.uTexel.value).toBeInstanceOf(THREE.Vector2);
    expect((u.uLineColor.value as THREE.Color).getHex()).toBe(0x000000);
    // Sobel fragments reference normal + depth textures.
    expect(src.fragmentShader).toContain("tNormal");
    expect(src.fragmentShader).toContain("tDepth");
    expect(src.fragmentShader).toContain("0.999"); // sky/non-terrain mask
  });

  it("default edge params match plan (pure-black lines, ~1px)", () => {
    const { pass } = makePass();
    const u = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
    expect(u.uEdgeStrength.value).toBeCloseTo(1.0, 6);
  });

  it("setSize resizes the RT and updates the texel uniform", () => {
    const { pass } = makePass();
    pass.setSize(128, 96);
    expect(pass.normalDepthRT.width).toBe(128);
    expect(pass.normalDepthRT.height).toBe(96);
    const texel = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad
      .material.uniforms.uTexel.value as THREE.Vector2;
    expect(texel.x).toBeCloseTo(1 / 128, 8);
    expect(texel.y).toBeCloseTo(1 / 96, 8);
  });

  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });
});
