import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial, makeCel } from "./cel";
import { celGradient } from "./gradient";

describe("CelMaterial", () => {
  it("applies plan defaults (bands 3, rim on, specular off, no FLAT define)", () => {
    const m = new CelMaterial();
    expect(m.uniforms.uBands.value).toBe(3);
    expect(m.uniforms.uBandEdge.value).toBeCloseTo(0.12, 6);
    expect(m.uniforms.uRimIntensity.value).toBeCloseTo(0.3, 6);
    expect(m.uniforms.uRimPower.value).toBeCloseTo(2.0, 6);
    expect(m.uniforms.uColor.value).toBeInstanceOf(THREE.Color);
    expect(m.flatShading).toBe(false);
    expect(m.defines.SPECULAR).toBeUndefined();
    expect(m.defines.FLAT).toBeUndefined();
  });

  it("honors opts (color, bands, bandEdge, flatShading, specular)", () => {
    const m = makeCel({
      color: 0xff5252,
      bands: 4,
      bandEdge: 0.2,
      flatShading: true,
      specular: true,
    });
    expect((m.uniforms.uColor.value as THREE.Color).getHex()).toBe(0xff5252);
    expect(m.uniforms.uBands.value).toBe(4);
    expect(m.uniforms.uBandEdge.value).toBeCloseTo(0.2, 6);
    expect(m.flatShading).toBe(true);
    expect(m.defines.FLAT).toBe("");
    expect(m.defines.SPECULAR).toBe("");
    expect(m.uniforms.uSpecularShininess.value).toBe(32);
  });

  it("cel band math uses AA edges (smoothstep), not a hard floor", () => {
    const m = new CelMaterial();
    expect(m.fragmentShader).toContain("uBandEdge");
    expect(m.fragmentShader).toContain("smoothstep(1.0 - uBandEdge, 1.0, f)");
    expect(m.fragmentShader).not.toMatch(/floor\(NdL \* uBands\) \/ uBands/);
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

  it("vertex shader applies instanceMatrix under USE_INSTANCING (InstancedMesh)", () => {
    const m = new CelMaterial();
    // Guarded block present + references instanceMatrix on position and normal.
    expect(m.vertexShader).toContain("#ifdef USE_INSTANCING");
    expect(m.vertexShader).toMatch(/instanceMatrix \* vec4\(position/);
    expect(m.vertexShader).toMatch(/mat3\(instanceMatrix\) \* normal/);
    // Non-instanced fallback: transformed initialised from position/normal
    // before the guarded block, so plain meshes are unaffected.
    expect(m.vertexShader).toContain("vec3 transformed = position;");
  });

  it("is lit (lights:true) and includes the three shadow chunks", () => {
    const m = new CelMaterial();
    expect(m.lights).toBe(true);
    // Shadow coord plumbing (vertex) + getShadow/struct (fragment).
    expect(m.vertexShader).toContain("#include <shadowmap_pars_vertex>");
    expect(m.vertexShader).toContain("NUM_DIR_LIGHT_SHADOWS");
    expect(m.fragmentShader).toContain("#include <shadowmap_pars_fragment>");
    expect(m.fragmentShader).toContain("getShadow(");
    // Sun term multiplied by the shadow mask (guarded so it compiles out).
    expect(m.fragmentShader).toContain("#ifdef USE_SHADOWMAP");
  });

  it("heightMap opts switch to the per-pixel heightmap normal path", () => {
    const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const m = makeCel({
      vertexColors: true,
      heightMap: { texture: tex, origin: [-100, -100], size: 200, texels: 256 },
    });
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.uniforms.uHeightMap.value).toBe(tex);
    expect((m.uniforms.uHeightOrigin.value as THREE.Vector2).x).toBe(-100);
    expect(m.uniforms.uHeightSize.value).toBe(200);
    // world units per texel = size / texels.
    expect(m.uniforms.uHeightTexelWorld.value).toBeCloseTo(200 / 256, 6);
    // Vertex passes world x,z; fragment reconstructs the normal from 4
    // neighbour taps (no per-vertex normal fold -> no diagonal cel banding).
    expect(m.vertexShader).toContain("varying vec2 vWorldXZ;");
    expect(m.fragmentShader).toContain("texture2D(uHeightMap");
    // HEIGHT_MAP takes precedence over the default vViewNormal path.
    expect(m.fragmentShader).toContain("#ifdef HEIGHT_MAP");
    // three's fragment prefix omits `normalMatrix`; the HEIGHT_MAP block
    // declares it itself to map the world normal -> view. Without this the
    // fragment fails to compile and the terrain renders as nothing.
    expect(m.fragmentShader).toContain("uniform mat3 normalMatrix;");
    tex.dispose();
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
