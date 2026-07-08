import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CORONA_OPACITY, CORONA_SCALE, SunDisc } from "./SunDisc";
import { dayCycleState } from "./dayCycle";

const SUN_SHELL = 1500;

/**
 * Child order is load-bearing: `group.children = [core, corona]`
 * (core at index 0 — Environment.test.ts reaches it there). The corona is
 * the larger dimmer additive halo added by 074; the core is the pre-074
 * bright dot.
 */
function coreMesh(sun: SunDisc): THREE.Mesh {
  return sun.group.children[0] as THREE.Mesh;
}

function coronaMesh(sun: SunDisc): THREE.Mesh {
  return sun.group.children[1] as THREE.Mesh;
}

describe("SunDisc construction", () => {
  it("group holds a core + corona mesh (children.length 2)", () => {
    const sun = new SunDisc();
    expect(sun.group.children.length).toBe(2);
    sun.dispose();
  });

  it("both meshes are on layer 0", () => {
    const sun = new SunDisc();
    expect(coreMesh(sun).layers.isEnabled(0)).toBe(true);
    expect(coronaMesh(sun).layers.isEnabled(0)).toBe(true);
    sun.dispose();
  });

  it("core renderOrder -1; corona renderOrder -2 (corona draws first)", () => {
    const sun = new SunDisc();
    expect(coreMesh(sun).renderOrder).toBe(-1);
    expect(coronaMesh(sun).renderOrder).toBe(-2);
    expect(coronaMesh(sun).renderOrder).toBeLessThan(coreMesh(sun).renderOrder);
    sun.dispose();
  });

  it("both materials are additive MeshBasicMaterial, transparent, no fog/depthWrite", () => {
    const sun = new SunDisc();
    for (const mesh of [coreMesh(sun), coronaMesh(sun)]) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.transparent).toBe(true);
      expect(mat.fog).toBe(false);
      expect(mat.depthWrite).toBe(false);
    }
    sun.dispose();
  });

  it("core geometry matches the DynamicSky moon (IcosahedronGeometry(40,1))", () => {
    const sun = new SunDisc();
    const ref = new THREE.IcosahedronGeometry(40, 1);
    const disc = coreMesh(sun).geometry;
    const da = (disc.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const ra = (ref.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    expect(da.length).toBe(ra.length);
    for (let i = 0; i < ra.length; i++) expect(da[i]).toBe(ra[i]);
    ref.dispose();
    sun.dispose();
  });

  it("corona radius scales by CORONA_SCALE (default radius 40 -> ~100)", () => {
    const sun = new SunDisc();
    const geo = coronaMesh(sun).geometry;
    geo.computeBoundingSphere();
    expect(geo.boundingSphere!.radius).toBeCloseTo(40 * CORONA_SCALE, 5);
    sun.dispose();
  });

  it("custom radius honored on BOTH (core 20, corona 20 * CORONA_SCALE)", () => {
    const sun = new SunDisc({ radius: 20 });
    const coreGeo = coreMesh(sun).geometry;
    coreGeo.computeBoundingSphere();
    expect(coreGeo.boundingSphere!.radius).toBeCloseTo(20, 6);
    const coronaGeo = coronaMesh(sun).geometry;
    coronaGeo.computeBoundingSphere();
    expect(coronaGeo.boundingSphere!.radius).toBeCloseTo(20 * CORONA_SCALE, 5);
    sun.dispose();
  });

  it("default color is the dayCycle day sun tint (0xffe8b0) on BOTH", () => {
    const sun = new SunDisc();
    const expected = new THREE.Color(0xffe8b0).getHex();
    const coreMat = coreMesh(sun).material as THREE.MeshBasicMaterial;
    const coronaMat = coronaMesh(sun).material as THREE.MeshBasicMaterial;
    expect(coreMat.color.getHex()).toBe(expected);
    expect(coronaMat.color.getHex()).toBe(expected);
    sun.dispose();
  });

  it("hidden until the first update (both visible false, opacity 0)", () => {
    const sun = new SunDisc();
    expect(coreMesh(sun).visible).toBe(false);
    expect(coronaMesh(sun).visible).toBe(false);
    expect((coreMesh(sun).material as THREE.MeshBasicMaterial).opacity).toBe(0);
    expect((coronaMesh(sun).material as THREE.MeshBasicMaterial).opacity).toBe(0);
    sun.dispose();
  });
});

describe("SunDisc update", () => {
  it("positions BOTH along sunDirWorld * SUN_SHELL", () => {
    const sun = new SunDisc();
    const core = coreMesh(sun);
    const corona = coronaMesh(sun);
    const savedDir = dayCycleState.sunDirWorld.clone();
    const savedNf = dayCycleState.nightFactor;
    try {
      const dir = new THREE.Vector3(1, 1, 0).normalize();
      dayCycleState.sunDirWorld.copy(dir);
      dayCycleState.nightFactor = 0;
      sun.update();
      for (const mesh of [core, corona]) {
        expect(mesh.position.x).toBeCloseTo(dir.x * SUN_SHELL, 6);
        expect(mesh.position.y).toBeCloseTo(dir.y * SUN_SHELL, 6);
        expect(mesh.position.z).toBeCloseTo(dir.z * SUN_SHELL, 6);
      }
    } finally {
      dayCycleState.sunDirWorld.copy(savedDir);
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("CORE opacity = 1 - nightFactor (day -> 1, dusk 0.3 -> 0.7, night -> 0)", () => {
    const sun = new SunDisc();
    const mat = coreMesh(sun).material as THREE.MeshBasicMaterial;
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.nightFactor = 0;
      sun.update();
      expect(mat.opacity).toBeCloseTo(1, 6);
      dayCycleState.nightFactor = 1;
      sun.update();
      expect(mat.opacity).toBeCloseTo(0, 6);
      dayCycleState.nightFactor = 0.3;
      sun.update();
      expect(mat.opacity).toBeCloseTo(0.7, 6);
    } finally {
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("corona opacity = core opacity * CORONA_OPACITY (day + dusk)", () => {
    const sun = new SunDisc();
    const coreMat = coreMesh(sun).material as THREE.MeshBasicMaterial;
    const coronaMat = coronaMesh(sun).material as THREE.MeshBasicMaterial;
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.nightFactor = 0;
      sun.update();
      expect(coronaMat.opacity).toBeCloseTo(1 * CORONA_OPACITY, 6);
      expect(coronaMat.opacity).toBeCloseTo(coreMat.opacity * CORONA_OPACITY, 6);
      dayCycleState.nightFactor = 0.3;
      sun.update();
      expect(coronaMat.opacity).toBeCloseTo(0.7 * CORONA_OPACITY, 6);
    } finally {
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("visibility toggles together: hidden at night, visible by day", () => {
    const sun = new SunDisc();
    const core = coreMesh(sun);
    const corona = coronaMesh(sun);
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.nightFactor = 1; // opacity 0
      sun.update();
      expect(core.visible).toBe(false);
      expect(corona.visible).toBe(false);
      dayCycleState.nightFactor = 0; // opacity 1
      sun.update();
      expect(core.visible).toBe(true);
      expect(corona.visible).toBe(true);
    } finally {
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("position magnitude is exactly SUN_SHELL for a unit sunDirWorld (core)", () => {
    const sun = new SunDisc();
    const mesh = coreMesh(sun);
    const savedDir = dayCycleState.sunDirWorld.clone();
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.sunDirWorld.set(0, 1, 0);
      dayCycleState.nightFactor = 0;
      sun.update();
      expect(mesh.position.length()).toBe(1500);
    } finally {
      dayCycleState.sunDirWorld.copy(savedDir);
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("custom radius does not affect positioning (still sunDirWorld * 1500)", () => {
    const sun = new SunDisc({ radius: 20 });
    const mesh = coreMesh(sun);
    const savedDir = dayCycleState.sunDirWorld.clone();
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.sunDirWorld.set(0, 1, 0);
      dayCycleState.nightFactor = 0;
      sun.update();
      expect(mesh.position.y).toBe(1500);
      expect(mesh.position.length()).toBe(1500);
    } finally {
      dayCycleState.sunDirWorld.copy(savedDir);
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("CORE opacity is exactly 1 - nightFactor, unclamped outside [0,1]", () => {
    const sun = new SunDisc();
    const mat = coreMesh(sun).material as THREE.MeshBasicMaterial;
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.nightFactor = 0;
      sun.update();
      expect(mat.opacity).toBe(1);
      dayCycleState.nightFactor = 0.5;
      sun.update();
      expect(mat.opacity).toBe(0.5);
      dayCycleState.nightFactor = 1;
      sun.update();
      expect(mat.opacity).toBe(0);
      // Out-of-range nightFactor does not crash; opacity is unclamped.
      dayCycleState.nightFactor = -1;
      expect(() => sun.update()).not.toThrow();
      expect(mat.opacity).toBe(2);
      dayCycleState.nightFactor = 2;
      expect(() => sun.update()).not.toThrow();
      expect(mat.opacity).toBe(-1);
    } finally {
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });
});

describe("SunDisc dispose", () => {
  it("is idempotent (calling twice does not throw)", () => {
    const sun = new SunDisc();
    sun.dispose();
    expect(() => sun.dispose()).not.toThrow();
  });

  it("frees both geometries + both materials (core + corona)", () => {
    const sun = new SunDisc();
    const core = coreMesh(sun);
    const corona = coronaMesh(sun);
    // Two distinct geometries + two distinct materials are reachable.
    expect(core.geometry).not.toBe(corona.geometry);
    expect(core.material).not.toBe(corona.material);
    // dispose touches all four; three dispose is event-only + idempotent, so
    // re-disposing each resource individually after SunDisc.dispose is safe.
    sun.dispose();
    expect(() => core.geometry.dispose()).not.toThrow();
    expect(() => corona.geometry.dispose()).not.toThrow();
    expect(() => (core.material as THREE.MeshBasicMaterial).dispose()).not.toThrow();
    expect(() => (corona.material as THREE.MeshBasicMaterial).dispose()).not.toThrow();
  });
});
