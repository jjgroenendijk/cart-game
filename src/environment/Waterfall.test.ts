import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Waterfall } from "./Waterfall";

function meshes(w: Waterfall): THREE.Mesh[] {
  return w.group.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
}

function points(w: Waterfall): THREE.Points {
  return w.group.children.find((c) => c instanceof THREE.Points) as THREE.Points;
}

describe("Waterfall", () => {
  it("builds a non-empty group with cliff/sheet/pool meshes + a mist Points field", () => {
    const w = new Waterfall();
    // cliff (3 boxes) + 2 sheet planes + pool disc + foam ring = 7 meshes.
    expect(meshes(w).length).toBeGreaterThanOrEqual(6);
    const pts = points(w);
    expect(pts).toBeDefined();
    expect(pts.isPoints).toBe(true);
    // Mist field: soft, no depth write, not culled (mirrors Weather).
    const mistMat = pts.material as THREE.ShaderMaterial;
    expect(mistMat.depthWrite).toBe(false);
    expect(pts.frustumCulled).toBe(false);
    // Mist geometry carries the position + velocity attributes the vert reads.
    expect(pts.geometry.getAttribute("position")).toBeDefined();
    expect(pts.geometry.getAttribute("velocity")).toBeDefined();
    w.dispose();
  });

  it("is world-fixed at the given position (does not follow focus)", () => {
    const w = new Waterfall({ position: [12, 3, -8] });
    expect(w.group.position.x).toBe(12);
    expect(w.group.position.y).toBe(3);
    expect(w.group.position.z).toBe(-8);
    // update's focus args are accepted but must NOT move the group.
    w.update(1, 999, -999);
    expect(w.group.position.x).toBe(12);
    expect(w.group.position.z).toBe(-8);
    w.dispose();
  });

  it("update advances uTime monotonically and fans it out to animated materials", () => {
    const w = new Waterfall();
    expect(w.elapsed).toBe(0);
    w.update(0.5);
    expect(w.elapsed).toBeCloseTo(0.5, 6);
    w.update(0.25);
    expect(w.elapsed).toBeCloseTo(0.75, 6);
    // The mist material's uTime reflects the accumulator.
    const mistMat = points(w).material as THREE.ShaderMaterial;
    expect(mistMat.uniforms.uTime.value).toBeCloseTo(0.75, 6);
    // Every animated Mesh material tracks the same accumulator.
    for (const m of meshes(w)) {
      const mat = m.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uTime) expect(mat.uniforms.uTime.value).toBeCloseTo(0.75, 6);
    }
    w.dispose();
  });

  it("update(0) is a safe no-op that leaves uTime unchanged", () => {
    const w = new Waterfall();
    w.update(1.0);
    const before = w.elapsed;
    expect(() => w.update(0)).not.toThrow();
    expect(w.elapsed).toBe(before);
    w.dispose();
  });

  it("honours width/height/scale/seed options + mist count", () => {
    const w = new Waterfall({ width: 20, height: 40, scale: 2, seed: 7, mistCount: 120 });
    expect(w.group.scale.x).toBe(2);
    const pts = points(w);
    expect(pts.geometry.getAttribute("position").count).toBe(120);
    w.dispose();
  });

  it("dispose empties the group and is idempotent", () => {
    const w = new Waterfall();
    expect(w.group.children.length).toBeGreaterThan(0);
    w.dispose();
    expect(w.group.children.length).toBe(0);
    expect(() => w.dispose()).not.toThrow();
  });
});
