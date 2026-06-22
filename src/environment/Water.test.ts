import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelWaterMaterial } from "../materials/celWater";
import { lightUniforms } from "../materials/lightUniforms";
import { Water } from "./Water";

describe("CelWaterMaterial", () => {
  it("is a ShaderMaterial (never MeshStandardMaterial)", () => {
    const m = new CelWaterMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.isShaderMaterial).toBe(true);
  });

  it("enables fog (water reaches the horizon)", () => {
    expect(new CelWaterMaterial().fog).toBe(true);
  });

  it("shares module-level light uniforms by reference", () => {
    const m = new CelWaterMaterial();
    expect(m.uniforms.uSunDir).toBe(lightUniforms.uSunDir);
    expect(m.uniforms.uSunColor).toBe(lightUniforms.uSunColor);
    expect(m.uniforms.uAmbient).toBe(lightUniforms.uAmbient);
  });

  it("applies plan defaults (amp 0.15, bands 2, uTime 0)", () => {
    const m = new CelWaterMaterial();
    expect(m.uniforms.uAmp.value).toBeCloseTo(0.15, 6);
    expect(m.uniforms.uBands.value).toBe(2);
    expect(m.uTime).toBe(0);
  });

  it("vertex shader sums two directional sines; fragment cel-bands facing", () => {
    const m = new CelWaterMaterial();
    expect(m.vertexShader).toMatch(/sin\(pos\.x/);
    expect(m.vertexShader).toMatch(/sin\(pos\.z/);
    expect(m.fragmentShader).toContain("floor(facing * uBands)");
    expect(m.fragmentShader).toMatch(/pow\(1\.0 - facing/); // fresnel rim
  });

  it("applies linear fog under USE_FOG (consumes injected fog uniforms)", () => {
    const m = new CelWaterMaterial();
    expect(m.fragmentShader).toContain("#ifdef USE_FOG");
    expect(m.fragmentShader).toContain("smoothstep(fogNear, fogFar");
  });

  it("uTime setter writes the uniform", () => {
    const m = new CelWaterMaterial();
    m.uTime = 12.5;
    expect(m.uniforms.uTime.value).toBe(12.5);
    expect(m.uTime).toBe(12.5);
  });
});

describe("Water", () => {
  it("mesh lives on layer 1 (post Sobel) and not layer 0", () => {
    const w = new Water();
    expect(w.mesh.layers.isEnabled(1)).toBe(true);
    expect(w.mesh.layers.isEnabled(0)).toBe(false);
  });

  it("uses a CelWaterMaterial and receives shadows", () => {
    const w = new Water();
    expect(w.mesh.material).toBeInstanceOf(CelWaterMaterial);
    expect(w.mesh.receiveShadow).toBe(true);
  });

  it("plane is flat in XZ at the configured level", () => {
    const w = new Water({ level: -5 });
    const bb = new THREE.Box3().setFromObject(w.mesh);
    expect(bb.min.y).toBeCloseTo(-5, 5);
    expect(bb.max.y).toBeCloseTo(-5, 5);
    expect(bb.max.x - bb.min.x).toBeCloseTo(200, 0);
  });

  it("update(time) advances the material uTime", () => {
    const w = new Water();
    w.update(7.25);
    const mat = w.mesh.material as CelWaterMaterial;
    expect(mat.uTime).toBe(7.25);
  });

  it("dispose frees geometry + material and is idempotent", () => {
    const w = new Water();
    expect(() => w.dispose()).not.toThrow();
    expect(() => w.dispose()).not.toThrow();
  });
});
