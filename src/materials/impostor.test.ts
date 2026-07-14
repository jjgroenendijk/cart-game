import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ImpostorMaterial,
  IMPOSTOR_ALPHA_TEST,
  impostorAtlasLayout,
  impostorCellRect,
  useImpostor,
} from "./impostor";
import { CelMaterial } from "./cel";
import { FADE_DISCARD_GLSL } from "./fade";

function atlas(): { albedo: THREE.Texture; normal: THREE.Texture } {
  return { albedo: new THREE.Texture(), normal: new THREE.Texture() };
}

describe("impostorAtlasLayout", () => {
  it("packs cells into a square-ish grid", () => {
    expect(impostorAtlasLayout(1)).toEqual({ cols: 1, rows: 1, cells: 1 });
    expect(impostorAtlasLayout(4)).toEqual({ cols: 2, rows: 2, cells: 4 });
    expect(impostorAtlasLayout(5)).toEqual({ cols: 3, rows: 2, cells: 5 });
    expect(impostorAtlasLayout(9)).toEqual({ cols: 3, rows: 3, cells: 9 });
  });

  it("clamps a zero/negative count to a single cell", () => {
    expect(impostorAtlasLayout(0)).toEqual({ cols: 1, rows: 1, cells: 1 });
    expect(impostorAtlasLayout(-3)).toEqual({ cols: 1, rows: 1, cells: 1 });
  });
});

describe("impostorCellRect", () => {
  it("tiles cells row-major with 1/cols x 1/rows spans", () => {
    const layout = impostorAtlasLayout(4); // 2x2
    expect(impostorCellRect(0, layout)).toEqual({ u0: 0, v0: 0, du: 0.5, dv: 0.5 });
    expect(impostorCellRect(1, layout)).toEqual({ u0: 0.5, v0: 0, du: 0.5, dv: 0.5 });
    expect(impostorCellRect(2, layout)).toEqual({ u0: 0, v0: 0.5, du: 0.5, dv: 0.5 });
    expect(impostorCellRect(3, layout)).toEqual({ u0: 0.5, v0: 0.5, du: 0.5, dv: 0.5 });
  });

  it("clamps an out-of-range index into the last cell", () => {
    const layout = impostorAtlasLayout(4);
    expect(impostorCellRect(99, layout)).toEqual(impostorCellRect(3, layout));
    expect(impostorCellRect(-1, layout)).toEqual(impostorCellRect(0, layout));
  });
});

describe("useImpostor selection", () => {
  it("switches to impostor at/after the start radius", () => {
    expect(useImpostor(199, 200)).toBe(false);
    expect(useImpostor(200, 200)).toBe(true);
    expect(useImpostor(260, 200)).toBe(true);
  });

  it("hysteresis holds the current state across the boundary (no flap)", () => {
    // Mesh (currentlyImpostor=false) needs to clear start + hysteresis.
    expect(useImpostor(205, 200, 10, false)).toBe(false);
    expect(useImpostor(210, 200, 10, false)).toBe(true);
    // Impostor (currentlyImpostor=true) holds until below start - hysteresis.
    expect(useImpostor(195, 200, 10, true)).toBe(true);
    expect(useImpostor(190, 200, 10, true)).toBe(false);
  });
});

describe("ImpostorMaterial", () => {
  it("shares the lightUniforms + cel band defaults, alpha test, fade", () => {
    const m = new ImpostorMaterial(atlas());
    expect(m.uniforms.uSunDir).toBeDefined();
    expect(m.uniforms.uSunColor).toBeDefined();
    expect(m.uniforms.uAmbient).toBeDefined();
    expect(m.uniforms.uBands.value).toBe(3);
    expect(m.uniforms.uBandEdge.value).toBeCloseTo(0.12, 6);
    expect(m.uniforms.uAlphaTest.value).toBe(IMPOSTOR_ALPHA_TEST);
    expect(m.uniforms.uFade.value).toBe(1);
    expect(m.uniforms.uAlbedo.value).toBeInstanceOf(THREE.Texture);
    expect(m.uniforms.uNormal.value).toBeInstanceOf(THREE.Texture);
  });

  it("is a yaw billboard: rebuilds the card basis from cameraPosition", () => {
    const m = new ImpostorMaterial(atlas());
    expect(m.vertexShader).toContain("cameraPosition");
    expect(m.vertexShader).toContain("cross(up, facing)");
    expect(m.vertexShader).toContain("toCam.y = 0.0");
  });

  it("relights with the SAME cel band math as CelMaterial", () => {
    const m = new ImpostorMaterial(atlas());
    const cel = new CelMaterial();
    const bandExpr = "smoothstep(1.0 - uBandEdge, 1.0, f)";
    expect(m.fragmentShader).toContain(bandExpr);
    expect(cel.fragmentShader).toContain(bandExpr);
    expect(m.fragmentShader).toContain("dot(N, L)");
    expect(m.fragmentShader).toContain("base * uSunColor * band + base * uAmbient");
  });

  it("alpha-tests the silhouette and dither-fades (shared fade GLSL)", () => {
    const m = new ImpostorMaterial(atlas());
    expect(m.fragmentShader).toContain("if (tex.a < uAlphaTest) discard");
    expect(m.fragmentShader).toContain(FADE_DISCARD_GLSL);
  });

  it("defaults fog ON (cel parity) and drops it when fog:false", () => {
    const on = new ImpostorMaterial(atlas());
    expect(on.fog).toBe(true);
    expect(on.uniforms.fogColor.value).toBeInstanceOf(THREE.Color);
    expect(on.fragmentShader).toContain("smoothstep(fogNear, fogFar, vViewDepth)");
    const off = new ImpostorMaterial({ ...atlas(), fog: false });
    expect(off.fog).toBe(false);
    expect(off.uniforms.fogColor).toBeUndefined();
    expect(off.fragmentShader).not.toContain("fogColor");
  });
});
