import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelWaterMaterial } from "./celWater";
import { WAVE, FOAM, GLINT_HDR_GAIN, GLINT_POWER } from "./waterShading";
import { lightUniforms } from "./lightUniforms";

function heightField(
  texels = 8,
  size = 200,
): {
  field: {
    texture: THREE.DataTexture;
    origin: [number, number];
    size: number;
    texels: number;
  };
  tex: THREE.DataTexture;
} {
  const tex = new THREE.DataTexture(
    new Float32Array(texels * texels * 4),
    texels,
    texels,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  const origin = -size / 2;
  return {
    field: { texture: tex, origin: [origin, origin], size, texels },
    tex,
  };
}

describe("CelWaterMaterial — WAVE constants mirrored into the vertex shader", () => {
  it("interpolates the shared AX/TX/AZ/TZ literals into both sines", () => {
    const m = new CelWaterMaterial();
    expect(m.vertexShader).toContain(`sin(pos.x * ${WAVE.AX} + uTime * ${WAVE.TX})`);
    expect(m.vertexShader).toContain(`sin(pos.z * ${WAVE.AZ} + uTime * ${WAVE.TZ})`);
    // Numeric pinning: the JS table is the single source of truth.
    expect(WAVE.AX).toBe(0.6);
    expect(WAVE.TX).toBe(1.1);
    expect(WAVE.AZ).toBe(0.5);
    expect(WAVE.TZ).toBe(0.9);
    m.dispose();
  });
});

describe("CelWaterMaterial — depth/foam/glint uniforms", () => {
  it("declares the new uniforms with plan defaults", () => {
    const m = new CelWaterMaterial();
    expect(m.uniforms.uWaterY.value).toBe(-3);
    expect(m.uniforms.uFoamColor.value).toBeInstanceOf(THREE.Color);
    expect((m.uniforms.uFoamColor.value as THREE.Color).getHex()).toBe(0xfdfdfd);
    expect(m.uniforms.uFoamWidth.value).toBeCloseTo(1.0, 6);
    expect(m.uniforms.uDeepDepth.value).toBeCloseTo(6.0, 6);
    expect(m.uniforms.uGlintIntensity.value).toBeCloseTo(1.0, 6);
    m.dispose();
  });

  it("opts flow into uWaterY/uFoamColor/uFoamWidth/uDeepDepth/uGlintIntensity", () => {
    const m = new CelWaterMaterial({
      waterY: 2.5,
      foamColor: 0x112233,
      foamWidth: 1.4,
      deepDepth: 8,
      glintIntensity: 0.3,
    });
    expect(m.uniforms.uWaterY.value).toBeCloseTo(2.5, 6);
    expect((m.uniforms.uFoamColor.value as THREE.Color).getHex()).toBe(
      new THREE.Color(0x112233).getHex(),
    );
    expect(m.uniforms.uFoamWidth.value).toBeCloseTo(1.4, 6);
    expect(m.uniforms.uDeepDepth.value).toBeCloseTo(8, 6);
    expect(m.uniforms.uGlintIntensity.value).toBeCloseTo(0.3, 6);
    m.dispose();
  });

  it("glintIntensity getter/setter writes the uniform", () => {
    const m = new CelWaterMaterial();
    m.glintIntensity = 0;
    expect(m.uniforms.uGlintIntensity.value).toBe(0);
    expect(m.glintIntensity).toBe(0);
    m.dispose();
  });

  it("uSunDirWorld (world-space sun) is bound from the shared light uniforms", () => {
    const m = new CelWaterMaterial();
    expect(m.uniforms.uSunDirWorld).toBe(lightUniforms.uSunDirWorld);
    m.dispose();
  });
});

describe("CelWaterMaterial — heightMap descriptor path", () => {
  it("adds HEIGHT_MAP define + binds uHeightMap/uHeightOrigin/uHeightSize/uHeightTexels", () => {
    const { field, tex } = heightField(16, 200);
    const m = new CelWaterMaterial({ heightMap: field, waterY: -3 });
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.uniforms.uHeightMap.value).toBe(tex);
    expect((m.uniforms.uHeightOrigin.value as THREE.Vector2).x).toBe(-100);
    expect((m.uniforms.uHeightOrigin.value as THREE.Vector2).y).toBe(-100);
    expect(m.uniforms.uHeightSize.value).toBe(200);
    expect(m.uniforms.uHeightTexels.value).toBe(16);
    tex.dispose();
    m.dispose();
  });

  it("no descriptor: no HEIGHT_MAP define and no height-map uniforms (legacy)", () => {
    const m = new CelWaterMaterial();
    expect(m.defines.HEIGHT_MAP).toBeUndefined();
    expect(m.uniforms.uHeightMap).toBeUndefined();
    expect(m.uniforms.uHeightOrigin).toBeUndefined();
    expect(m.uniforms.uHeightSize).toBeUndefined();
    expect(m.uniforms.uHeightTexels).toBeUndefined();
    m.dispose();
  });
});

describe("CelWaterMaterial — mirrored GLSL expressions", () => {
  it("frag reads bed height via 4-tap bilinear and computes depth = uWaterY - bedH", () => {
    const m = new CelWaterMaterial();
    const frag = m.fragmentShader;
    // Out-of-field bounds guard + bilinear bed-height sample (4 taps).
    expect(frag).toContain("#ifdef HEIGHT_MAP");
    expect(frag).toContain("uniform float uHeightTexels");
    expect(frag).toContain("texture2D(uHeightMap, vec2(uv0.x, uv0.y)).r");
    expect(frag).toContain("mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y)");
    expect(frag).toContain("depth = uWaterY - bedH");
    // UV mirrors cel.ts: (vWorldXZ - uHeightOrigin) / uHeightSize.
    expect(frag).toContain("(vWorldXZ - uHeightOrigin) / uHeightSize");
    m.dispose();
  });

  it("foam mirrors foamMask(): noise-warped, slope-gated, patchy caps", () => {
    const m = new CelWaterMaterial();
    const frag = m.fragmentShader;
    // Procedural value-noise (no asset) drives the coastline warp + detail.
    expect(frag).toContain("float valueNoise");
    expect(frag).toContain("float hash21");
    // Band edges (FOAM.EDGE_INNER/OUTER interpolated from the shared table).
    expect(frag).toContain(`${FOAM.EDGE_INNER} * uFoamWidth`);
    expect(frag).toContain(`${FOAM.EDGE_OUTER} * uFoamWidth`);
    // Anti-aliased falloff warped by spatial noise of world XZ.
    expect(frag).toContain("1.0 - smoothstep(edge0, edge1, d)");
    // WARP + DETAIL tuning interpolated from the FOAM table.
    expect(frag).toContain(`${FOAM.WARP_FREQ}`);
    expect(frag).toContain(`${FOAM.DETAIL_GAIN}`);
    // Bed slope from the free 4-tap finite difference, gating foam so flat
    // basins read blue and banks keep the lather.
    expect(frag).toContain("float slope = 0.0;");
    expect(frag).toContain("slope = sqrt(dsdx * dsdx + dsdz * dsdz)");
    expect(frag).toContain(`${FOAM.SLOPE_MIN}`);
    expect(frag).toContain(`smoothstep(${FOAM.SLOPE_LO}, ${FOAM.SLOPE_HI}, slope)`);
    m.dispose();
  });

  it("depth tint mirrors depthTintMix(): clamp(depth/uDeepDepth,0,1)", () => {
    const m = new CelWaterMaterial();
    const frag = m.fragmentShader;
    expect(frag).toContain("clamp(depth / uDeepDepth, 0.0, 1.0)");
    // In-field mixes shallow->deep; out-of-field keeps the facing mix.
    expect(frag).toContain("mix(uShallow, uDeep, mixF)");
    expect(frag).toContain("mix(uDeep, uShallow, facing)");
    m.dispose();
  });

  it("glint mirrors glintSpecular(): continuous HDR world-space highlight", () => {
    const m = new CelWaterMaterial();
    const frag = m.fragmentShader;
    // World-space ripple normal (analytic d/dx,d/dz of the vertex sines).
    expect(frag).toContain(`uAmp * ${WAVE.AX} * cos(${WAVE.AX} * vWorldXZ.x`);
    expect(frag).toContain(`uAmp * ${WAVE.AZ} * cos(${WAVE.AZ} * vWorldXZ.y`);
    expect(frag).toContain("vec3 Nworld = normalize(vec3(-dsdx, 1.0, -dsdz))");
    // Half-vector = normalize(uSunDirWorld + Vworld) in WORLD space.
    expect(frag).toContain("normalize(uSunDirWorld + Vworld)");
    expect(frag).toContain(`pow(clamp(dot(Nworld, H), 0.0, 1.0), ${GLINT_POWER}.0)`);
    expect(frag).toContain(`* uGlintIntensity * ${GLINT_HDR_GAIN}`);
    expect(frag).not.toContain("spec >=");
    expect(frag).toContain("glintTerm = uSunColor * glint");
    expect(frag).toContain("color += glintTerm");
    m.dispose();
  });

  it("glint is skipped when uGlintIntensity <= 0 (low-tier knob guard)", () => {
    const m = new CelWaterMaterial();
    expect(m.fragmentShader).toContain("if (uGlintIntensity > 0.0)");
    m.dispose();
  });

  it("foam is applied BEFORE uTint; uTint multiplies last before fog (025 parity)", () => {
    const m = new CelWaterMaterial();
    const frag = m.fragmentShader;
    const foamIdx = frag.indexOf("mix(color, uFoamColor, foam)");
    const tintIdx = frag.indexOf("color *= uTint");
    // The fog *application* (not the top uniform declaration) must follow tint.
    const fogIdx = frag.indexOf("color = mix(color, fogColor, fogFactor)");
    expect(foamIdx).toBeGreaterThan(-1);
    expect(tintIdx).toBeGreaterThan(foamIdx);
    expect(fogIdx).toBeGreaterThan(tintIdx);
    m.dispose();
  });

  it("vert passes world XZ (vWorldXZ) from modelMatrix, independent of focus", () => {
    const m = new CelWaterMaterial();
    expect(m.vertexShader).toContain("varying vec2 vWorldXZ;");
    expect(m.vertexShader).toContain("(modelMatrix * vec4(position, 1.0)).xz");
    expect(m.fragmentShader).toContain("varying vec2 vWorldXZ;");
    m.dispose();
  });

  it("uses continuous facing + fresnel while retaining uBands compatibility", () => {
    const m = new CelWaterMaterial();
    const frag = m.fragmentShader;
    expect(m.uniforms.uBands.value).toBe(2);
    expect(frag).toContain("uniform float uBands");
    expect(frag).toContain("float band = facing");
    expect(frag).not.toContain("floor(facing * uBands)");
    expect(frag).toContain("pow(1.0 - facing, 3.0)");
    m.dispose();
  });
});

describe("CelWaterMaterial — fallback compiles both paths", () => {
  it("no-descriptor shader omits the height-map block (legacy look compiles)", () => {
    const m = new CelWaterMaterial();
    // HEIGHT_MAP guard present, but no define -> block stripped at compile.
    expect(m.fragmentShader).toContain("#ifdef HEIGHT_MAP");
    expect(m.defines.HEIGHT_MAP).toBeUndefined();
    m.dispose();
  });

  it("descriptor shader includes the height-map block (depth path compiles)", () => {
    const { field, tex } = heightField();
    const m = new CelWaterMaterial({ heightMap: field });
    expect(m.defines.HEIGHT_MAP).toBe("");
    expect(m.fragmentShader).toContain("texture2D(uHeightMap, vec2(uv0.x, uv0.y)).r");
    tex.dispose();
    m.dispose();
  });

  it("dispose is safe for both variants", () => {
    const a = new CelWaterMaterial();
    expect(() => a.dispose()).not.toThrow();
    const { field, tex } = heightField();
    const b = new CelWaterMaterial({ heightMap: field });
    expect(() => b.dispose()).not.toThrow();
    tex.dispose();
  });
});

describe("CelWaterMaterial — emissiveOutput (selective-bloom glint emit)", () => {
  it("emissiveOutput:true adds the EMISSIVE_OUTPUT define", () => {
    const m = new CelWaterMaterial({ emissiveOutput: true });
    expect(m.defines.EMISSIVE_OUTPUT).toBe("");
    expect(m.fragmentShader).toContain("#ifdef EMISSIVE_OUTPUT");
    expect(m.fragmentShader).toContain("vec4(glintTerm, 1.0)");
    m.dispose();
  });

  it("absent / false: no EMISSIVE_OUTPUT define (byte-identical fallback)", () => {
    const absent = new CelWaterMaterial();
    expect(absent.defines.EMISSIVE_OUTPUT).toBeUndefined();
    absent.dispose();
    const off = new CelWaterMaterial({ emissiveOutput: false });
    expect(off.defines.EMISSIVE_OUTPUT).toBeUndefined();
    off.dispose();
  });

  it("EMISSIVE_OUTPUT is gated only on the opt (independent of glintIntensity)", () => {
    // emissiveOutput:true with glintIntensity 0 still has the define; the
    // material emits black (glintTerm stays vec3(0) since the if is skipped).
    const m = new CelWaterMaterial({ emissiveOutput: true, glintIntensity: 0 });
    expect(m.defines.EMISSIVE_OUTPUT).toBe("");
    // glintTerm declared outside the uGlintIntensity guard so the branch
    // compiles even when glint is off.
    expect(m.fragmentShader).toContain("vec3 glintTerm = vec3(0.0);");
    m.dispose();
  });
});
