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

  it("declares a uTint uniform and multiplies the final color by it", () => {
    const m = new CelWaterMaterial();
    expect(m.fragmentShader).toContain("uniform vec3 uTint");
    expect(m.fragmentShader).toContain("color *= uTint");
    expect(m.uniforms.uTint.value).toBeInstanceOf(THREE.Color);
  });

  it("default uTint is white (identity / parity)", () => {
    expect(new CelWaterMaterial().uniforms.uTint.value.getHex()).toBe(0xffffff);
  });

  it("tint opt sets uTint (LINEAR-converted; compare via THREE.Color)", () => {
    const m = new CelWaterMaterial({ tint: 0x112233 });
    expect(m.uniforms.uTint.value.getHex()).toBe(new THREE.Color(0x112233).getHex());
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

  it("defaults to the baked heightmap span when depth-aware water is enabled", () => {
    const texture = new THREE.DataTexture(new Float32Array(16), 4, 4, THREE.RedFormat);
    const w = new Water({
      heightMap: {
        texture,
        origin: [-185, -185],
        size: 370,
        texels: 4,
      },
      waterY: -3,
    });
    const bb = new THREE.Box3().setFromObject(w.mesh);
    expect(bb.max.x - bb.min.x).toBeCloseTo(370, 5);
    expect(bb.max.z - bb.min.z).toBeCloseTo(370, 5);
    expect(w.mesh.position.x).toBe(0);
    expect(w.mesh.position.z).toBe(0);
    w.dispose();
    texture.dispose();
  });

  it("update(time) advances the material uTime", () => {
    const w = new Water();
    w.update(7.25);
    const mat = w.mesh.material as CelWaterMaterial;
    expect(mat.uTime).toBe(7.25);
  });

  it("default Water -> uTint white (parity)", () => {
    const w = new Water();
    const mat = w.mesh.material as CelWaterMaterial;
    expect(mat.uniforms.uTint.value.getHex()).toBe(0xffffff);
    w.dispose();
  });

  it("color opt routes to the CelWaterMaterial uTint uniform", () => {
    const w = new Water({ color: 0x112233 });
    const mat = w.mesh.material as CelWaterMaterial;
    expect(mat.uniforms.uTint.value.getHex()).toBe(new THREE.Color(0x112233).getHex());
    w.dispose();
  });

  it("shallow + deep opts route to uShallow/uDeep uniforms", () => {
    const w = new Water({ shallow: 0x2db8b8, deep: 0x0a3a55 });
    const mat = w.mesh.material as CelWaterMaterial;
    expect(mat.uniforms.uShallow.value.getHex()).toBe(new THREE.Color(0x2db8b8).getHex());
    expect(mat.uniforms.uDeep.value.getHex()).toBe(new THREE.Color(0x0a3a55).getHex());
    w.dispose();
  });

  it("default Water -> uShallow/uDeep keep CelWater ctor defaults (parity)", () => {
    const w = new Water();
    const mat = w.mesh.material as CelWaterMaterial;
    expect(mat.uniforms.uShallow.value.getHex()).toBe(new THREE.Color(0x2a6a8a).getHex());
    expect(mat.uniforms.uDeep.value.getHex()).toBe(new THREE.Color(0x123a52).getHex());
    w.dispose();
  });

  it("update ignores focus — plane stays pinned to the baked heightmap square", () => {
    const w = new Water();
    w.update(0);
    // The depth heightmap is baked once over the static worldSize square, so
    // the plane must coincide with it (origin XZ) or foam only covers part of
    // the water. Following the focus would slide past the baked field.
    expect(w.mesh.position.x).toBe(0);
    expect(w.mesh.position.z).toBe(0);
    expect(w.mesh.position.y).toBe(-3);
    // matrixAutoUpdate is false; the constructor bakes the matrix once at the
    // spawn origin. elements[12] = tx, [13] = ty, [14] = tz in a Matrix4.
    const e = w.mesh.matrix.elements;
    expect(e[12]).toBe(0);
    expect(e[13]).toBe(-3);
    expect(e[14]).toBe(0);
    w.dispose();
  });

  it("dispose frees geometry + material and is idempotent", () => {
    const w = new Water();
    expect(() => w.dispose()).not.toThrow();
    expect(() => w.dispose()).not.toThrow();
  });
});
