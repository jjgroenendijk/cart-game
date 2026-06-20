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
