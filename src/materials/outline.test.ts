import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { InvertedHullMaterial, addOutline, removeOutline } from "./outline";

describe("InvertedHullMaterial", () => {
  it("uses BackSide + depthWrite=false + polygonOffset (no interior z-fight)", () => {
    const m = new InvertedHullMaterial(0.02);
    expect(m.side).toBe(THREE.BackSide);
    expect(m.depthWrite).toBe(false);
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBe(1);
    expect(m.polygonOffsetUnits).toBe(1);
  });

  it("defaults thickness to 0.02 and exposes a getter/setter", () => {
    const m = new InvertedHullMaterial();
    expect(m.thickness).toBeCloseTo(0.02, 6);
    m.thickness = 0.05;
    expect(m.thickness).toBeCloseTo(0.05, 6);
    expect(m.uniforms.uThickness.value).toBeCloseTo(0.05, 6);
  });

  it("uses a constant screen-space width (clip-space offset scales with clip.w)", () => {
    // Guards against regressing to the old world-space
    // `position + normal * thickness` (thins at distance, balloons up close)
    // or the incorrect `thickness / -mvPos.z` (also thins at distance).
    const m = new InvertedHullMaterial();
    expect(m.vertexShader).toContain("uThickness * clip.w");
    expect(m.vertexShader).not.toContain("position + normal");
    expect(m.vertexShader).not.toContain("/ -mvPos");
    expect(m.vertexShader).not.toContain("/ -mvPosition");
  });
});

describe("addOutline / removeOutline", () => {
  it("shares the source geometry and renders before the mesh", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const outline = addOutline(mesh, 0.03);
    expect(outline.parent).toBe(mesh);
    expect(outline.geometry).toBe(mesh.geometry); // shared, not cloned
    expect(outline.renderOrder).toBe(-1);
    expect(outline.material).toBeInstanceOf(InvertedHullMaterial);
    expect((outline.material as InvertedHullMaterial).thickness).toBeCloseTo(0.03, 6);
  });

  it("tags + disables shadows so the inflated hull never stamps a halo", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const outline = addOutline(mesh);
    expect(outline.userData.outlineHull).toBe(true);
    expect(outline.castShadow).toBe(false);
    expect(outline.receiveShadow).toBe(false);
  });

  it("dither fade adds uFade (default 1) + dither discard; off-path has neither", () => {
    const faded = new InvertedHullMaterial(0.02, "dither");
    expect(faded.uniforms.uFade.value).toBe(1);
    expect(faded.fragmentShader).toContain("uniform float uFade;");
    expect(faded.fragmentShader).toContain("fadeThreshold(gl_FragCoord.xy) > uFade) discard;");
    // Dither leaves the vertex thickness untouched (constant-width hull).
    expect(faded.vertexShader).not.toContain("uFade");
    const plain = new InvertedHullMaterial(0.02);
    expect(plain.uniforms.uFade).toBeUndefined();
    expect(plain.fragmentShader).not.toContain("uFade");
    expect(plain.fragmentShader).not.toContain("discard");
  });

  it("haze fade adds uFade + scales thickness by uFade (grow-in, no discard)", () => {
    const haze = new InvertedHullMaterial(0.02, "haze");
    expect(haze.uniforms.uFade.value).toBe(1);
    // Thickness scales with uFade -> rim widens from 0 (collapsed onto the mesh)
    // to full; the fragment stays plain black (no dither discard, no stipple).
    expect(haze.vertexShader).toContain("uThickness * clamp(uFade, 0.0, 1.0) * clip.w");
    expect(haze.fragmentShader).not.toContain("discard");
  });

  it("addOutline forwards the fade mode to the hull material", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const outline = addOutline(mesh, 0.02, "haze");
    const mat = outline.material as InvertedHullMaterial;
    expect(mat.uniforms.uFade.value).toBe(1);
    expect(mat.vertexShader).toContain("clamp(uFade, 0.0, 1.0)");
    const plain = addOutline(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    expect((plain.material as InvertedHullMaterial).uniforms.uFade).toBeUndefined();
  });

  it("removeOutline detaches the child and disposes its (unique) material, keeps geometry", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const outline = addOutline(mesh);
    const geo = mesh.geometry;
    const mat = outline.material as InvertedHullMaterial;
    const spy = vi.spyOn(mat, "dispose");

    removeOutline(outline);
    expect(outline.parent).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    // Source mesh geometry untouched.
    expect(mesh.geometry).toBe(geo);
  });
});
