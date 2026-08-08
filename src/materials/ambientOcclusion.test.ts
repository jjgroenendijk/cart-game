import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AmbientOcclusionPass, DEFAULT_AO_PARAMS } from "./ambientOcclusion";

function makePass() {
  const depthTexture = new THREE.Texture();
  const normalTexture = new THREE.Texture();
  return {
    depthTexture,
    normalTexture,
    pass: new AmbientOcclusionPass(depthTexture, normalTexture),
  };
}

function uniforms(pass: AmbientOcclusionPass) {
  return (pass.fullscreenMaterial as THREE.ShaderMaterial).uniforms;
}

function fragSrc(pass: AmbientOcclusionPass) {
  return (pass.fullscreenMaterial as THREE.ShaderMaterial).fragmentShader;
}

describe("AmbientOcclusionPass defaults", () => {
  it("defaults uAoStrength to 0 (identity until Renderer wires)", () => {
    const { pass } = makePass();
    expect(pass.aoStrength).toBe(0);
    expect(uniforms(pass).uAoStrength.value).toBe(0);
  });

  it("wires both shared textures (depth + view normal)", () => {
    const { depthTexture, normalTexture, pass } = makePass();
    expect(uniforms(pass).tDepth.value).toBe(depthTexture);
    expect(uniforms(pass).tViewNormal.value).toBe(normalTexture);
  });

  it("declares every required uniform", () => {
    const u = uniforms(makePass().pass);
    expect(u.tColor).toBeDefined();
    expect(u.tDepth).toBeDefined();
    expect(u.tViewNormal).toBeDefined();
    expect(u.uProjection).toBeDefined();
    expect(u.uInvProjection).toBeDefined();
    expect(u.uResolution).toBeDefined();
    expect(u.uAoStrength).toBeDefined();
    expect(u.uSlices).toBeDefined();
    expect(u.uRadius).toBeDefined();
    expect(u.uAoFloor).toBeDefined();
    expect(u.uDepthEps).toBeDefined();
    expect(u.uFrameIndex).toBeDefined();
  });

  it("DEFAULT_AO_PARAMS defaults flow into uniforms", () => {
    const u = uniforms(makePass().pass);
    expect(u.uRadius.value).toBe(DEFAULT_AO_PARAMS.radius);
    expect(u.uAoFloor.value).toBe(DEFAULT_AO_PARAMS.floor);
    expect(u.uSlices.value).toBe(DEFAULT_AO_PARAMS.slices);
    expect(u.uRadius.value).toBe(0.5);
    expect(u.uAoFloor.value).toBe(0.25);
    expect(u.uSlices.value).toBe(4);
  });

  it("ctor opts override the defaults", () => {
    const pass = new AmbientOcclusionPass(new THREE.Texture(), new THREE.Texture(), {
      slices: 6,
      floor: 0.3,
      radius: 0.8,
    });
    const u = uniforms(pass);
    expect(u.uSlices.value).toBe(6);
    expect(u.uAoFloor.value).toBeCloseTo(0.3, 6);
    expect(u.uRadius.value).toBeCloseTo(0.8, 6);
  });
});

describe("AmbientOcclusionPass shader (235)", () => {
  it("has the identity early-out at uAoStrength <= 0", () => {
    expect(fragSrc(makePass().pass)).toContain("uAoStrength <= 0.0");
  });

  it("skips sky pixels (depth >= 1.0 - uDepthEps)", () => {
    expect(fragSrc(makePass().pass)).toContain("depth >= 1.0 - uDepthEps");
  });

  it("unpacks every shared RGBA depth sample", () => {
    const src = fragSrc(makePass().pass);
    expect(src).toContain("#include <packing>");
    expect(src.match(/unpackRGBAToDepth\(texture2D\(tDepth/g)).toHaveLength(3);
  });

  it("reconstructs view position via the unproject (uInvProjection * ndc)", () => {
    const src = fragSrc(makePass().pass);
    expect(src).toContain("uInvProjection * ndc");
    expect(src).toContain("view.xyz /= view.w");
  });

  it("unpacks view normals (tViewNormal, * 2.0 - 1.0)", () => {
    const src = fragSrc(makePass().pass);
    expect(src).toContain("tViewNormal");
    expect(src).toContain("* 2.0 - 1.0");
  });

  it("has the GTAO slice loop bound GTAO_MAX_SLICES", () => {
    expect(fragSrc(makePass().pass)).toContain("GTAO_MAX_SLICES");
  });

  it("composites toward the ambient floor (uAoFloor, uAoStrength)", () => {
    const src = fragSrc(makePass().pass);
    expect(src).toContain("uAoFloor");
    expect(src).toContain("uAoStrength");
  });
});

describe("AmbientOcclusionPass.setAo", () => {
  it("writes the per-frame non-camera uniforms in one call", () => {
    const { pass } = makePass();
    pass.setAo(0.7, 5, 0.2, 3);
    const u = uniforms(pass);
    expect(u.uAoStrength.value).toBeCloseTo(0.7, 6);
    expect(u.uSlices.value).toBe(5);
    expect(u.uAoFloor.value).toBeCloseTo(0.2, 6);
    expect(u.uFrameIndex.value).toBe(3);
  });

  it("aoStrength getter reflects setAo's strength argument", () => {
    const { pass } = makePass();
    pass.setAo(0.7, 5, 0.2, 3);
    expect(pass.aoStrength).toBeCloseTo(0.7, 6);
  });
});

describe("AmbientOcclusionPass pass wiring", () => {
  it("needsSwap is true (reads readBuffer, writes writeBuffer)", () => {
    expect(makePass().pass.needsSwap).toBe(true);
  });
});

describe("AmbientOcclusionPass dispose", () => {
  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });
});
