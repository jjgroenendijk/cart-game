import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial, makeCel } from "./cel";
import { celGradient } from "./gradient";

describe("CelMaterial", () => {
  it("applies plan defaults (bands 3, rim on, specular off, no FLAT define)", () => {
    const m = new CelMaterial();
    expect(m.uniforms.uBands.value).toBe(3);
    expect(m.uniforms.uRimIntensity.value).toBeCloseTo(0.3, 6);
    expect(m.uniforms.uRimPower.value).toBeCloseTo(2.0, 6);
    expect(m.uniforms.uColor.value).toBeInstanceOf(THREE.Color);
    expect(m.flatShading).toBe(false);
    expect(m.defines.SPECULAR).toBeUndefined();
    expect(m.defines.FLAT).toBeUndefined();
  });

  it("honors opts (color, bands, flatShading, specular)", () => {
    const m = makeCel({ color: 0xff5252, bands: 4, flatShading: true, specular: true });
    expect((m.uniforms.uColor.value as THREE.Color).getHex()).toBe(0xff5252);
    expect(m.uniforms.uBands.value).toBe(4);
    expect(m.flatShading).toBe(true);
    expect(m.defines.FLAT).toBe("");
    expect(m.defines.SPECULAR).toBe("");
    expect(m.uniforms.uSpecularShininess.value).toBe(32);
  });

  it("toggling flatShading flips the FLAT define and marks the shader for recompile", () => {
    const m = new CelMaterial();
    expect(m.flatShading).toBe(false);
    expect(m.defines.FLAT).toBeUndefined();

    const v0 = m.version;
    m.flatShading = true;
    expect(m.defines.FLAT).toBe("");
    expect(m.version).toBeGreaterThan(v0); // needsUpdate -> version bumped

    const v1 = m.version;
    m.flatShading = false;
    expect(m.defines.FLAT).toBeUndefined();
    expect(m.version).toBeGreaterThan(v1);
  });

  it("shares module-level light uniforms by reference (one write fans out)", () => {
    const a = new CelMaterial();
    const b = new CelMaterial();
    expect(a.uniforms.uSunDir).toBe(b.uniforms.uSunDir);
    expect(a.uniforms.uSunColor).toBe(b.uniforms.uSunColor);
    expect(a.uniforms.uAmbient).toBe(b.uniforms.uAmbient);
  });

  it("dispose() frees GPU resources without throwing", () => {
    const m = new CelMaterial();
    expect(() => m.dispose()).not.toThrow();
  });

  it("vertexColors adds VERTEX_COLORS define, sets the flag, and emits vColor plumbing", () => {
    const m = makeCel({ vertexColors: true });
    expect(m.vertexColors).toBe(true);
    expect(m.defines.VERTEX_COLORS).toBe("");
    // Vertex shader assigns into vColor (the color attribute itself is
    // injected by three.js under USE_COLOR); fragment multiplies the base.
    expect(m.vertexShader).toContain("vColor = color;");
    expect(m.vertexShader).toContain("varying vec3 vColor;");
    expect(m.fragmentShader).toContain("base *= vColor;");
    expect(m.fragmentShader).toContain("varying vec3 vColor;");
  });

  it("vertexColors defaults off (no define; preprocessor strips guarded code)", () => {
    const m = new CelMaterial();
    expect(m.vertexColors).toBe(false);
    expect(m.defines.VERTEX_COLORS).toBeUndefined();
  });
});

describe("celGradient", () => {
  it("produces N nearest-sampled steps matching the shader's floor(NdL*bands)/bands math", () => {
    const tex = celGradient(3);
    const data = tex.image.data as Uint8Array;
    // step i = round((i+1)/bands * 255) -> [85, 170, 255] for bands=3
    expect(Array.from(data)).toEqual([85, 170, 255]);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
  });
});
