import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SunDisc, SUN_DISC_HDR_SCALE } from "./SunDisc";
import { dayCycleState } from "./dayCycle";

const SUN_SHELL = 1500;

function discMesh(sun: SunDisc): THREE.Mesh {
  return sun.group.children[0] as THREE.Mesh;
}

describe("SunDisc construction", () => {
  it("group holds a single mesh", () => {
    const sun = new SunDisc();
    expect(sun.group.children.length).toBe(1);
    sun.dispose();
  });

  it("mesh is on layer 0 with renderOrder -1", () => {
    const sun = new SunDisc();
    const mesh = discMesh(sun);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    expect(mesh.renderOrder).toBe(-1);
    sun.dispose();
  });

  it("material is additive MeshBasicMaterial (transparent, fog:false, depthWrite:false)", () => {
    const sun = new SunDisc();
    const mat = discMesh(sun).material as THREE.MeshBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.transparent).toBe(true);
    expect(mat.fog).toBe(false);
    expect(mat.depthWrite).toBe(false);
    sun.dispose();
  });

  it("default geometry matches the DynamicSky moon (IcosahedronGeometry(40,1))", () => {
    const sun = new SunDisc();
    const ref = new THREE.IcosahedronGeometry(40, 1);
    const disc = discMesh(sun).geometry;
    const da = (disc.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const ra = (ref.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    expect(da.length).toBe(ra.length);
    for (let i = 0; i < ra.length; i++) expect(da[i]).toBe(ra[i]);
    ref.dispose();
    sun.dispose();
  });

  it("custom radius is honored (bounding sphere radius)", () => {
    const sun = new SunDisc({ radius: 20 });
    const geo = discMesh(sun).geometry;
    geo.computeBoundingSphere();
    expect(geo.boundingSphere!.radius).toBeCloseTo(20, 6);
    sun.dispose();
  });

  it("default color is HDR-scaled from the dayCycle sun tint (peaks >1.0 for bloom)", () => {
    const sun = new SunDisc();
    const mat = discMesh(sun).material as THREE.MeshBasicMaterial;
    // Base tint 0xffe8b0 (dayCycle day sun) scaled by SUN_DISC_HDR_SCALE pushes
    // every channel above 1.0; the bloom threshold is 1.0, so only the genuine
    // sun blooms. ACES in OutputPass rolls the >1.0 value back to a bright disc.
    const base = new THREE.Color(0xffe8b0).multiplyScalar(SUN_DISC_HDR_SCALE);
    expect(mat.color.r).toBeCloseTo(base.r, 6);
    expect(mat.color.r).toBeGreaterThan(1); // HDR: above the bloom threshold
    sun.dispose();
  });

  it("custom color option is also HDR-scaled (peaks >1.0)", () => {
    const sun = new SunDisc({ color: 0xffd0a0 });
    const mat = discMesh(sun).material as THREE.MeshBasicMaterial;
    const base = new THREE.Color(0xffd0a0).multiplyScalar(SUN_DISC_HDR_SCALE);
    expect(mat.color.r).toBeCloseTo(base.r, 6);
    expect(mat.color.r).toBeGreaterThan(1);
    sun.dispose();
  });

  it("hidden until the first update (visible false, opacity 0)", () => {
    const sun = new SunDisc();
    const mesh = discMesh(sun);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mesh.visible).toBe(false);
    expect(mat.opacity).toBe(0);
    sun.dispose();
  });
});

describe("SunDisc update", () => {
  it("positions the disc along sunDirWorld * SUN_SHELL", () => {
    const sun = new SunDisc();
    const mesh = discMesh(sun);
    const savedDir = dayCycleState.sunDirWorld.clone();
    const savedNf = dayCycleState.nightFactor;
    try {
      const dir = new THREE.Vector3(1, 1, 0).normalize();
      dayCycleState.sunDirWorld.copy(dir);
      dayCycleState.nightFactor = 0;
      sun.update();
      expect(mesh.position.x).toBeCloseTo(dir.x * SUN_SHELL, 6);
      expect(mesh.position.y).toBeCloseTo(dir.y * SUN_SHELL, 6);
      expect(mesh.position.z).toBeCloseTo(dir.z * SUN_SHELL, 6);
    } finally {
      dayCycleState.sunDirWorld.copy(savedDir);
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("opacity = 1 - nightFactor (day -> 1, dusk 0.3 -> 0.7, night -> 0)", () => {
    const sun = new SunDisc();
    const mat = discMesh(sun).material as THREE.MeshBasicMaterial;
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

  it("visibility toggles: hidden at night, visible by day", () => {
    const sun = new SunDisc();
    const mesh = discMesh(sun);
    const savedNf = dayCycleState.nightFactor;
    try {
      dayCycleState.nightFactor = 1; // opacity 0
      sun.update();
      expect(mesh.visible).toBe(false);
      dayCycleState.nightFactor = 0; // opacity 1
      sun.update();
      expect(mesh.visible).toBe(true);
    } finally {
      dayCycleState.nightFactor = savedNf;
    }
    sun.dispose();
  });

  it("position magnitude is exactly SUN_SHELL for a unit sunDirWorld", () => {
    const sun = new SunDisc();
    const mesh = discMesh(sun);
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
    const mesh = discMesh(sun);
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

  it("opacity is exactly 1 - nightFactor, unclamped outside [0,1]", () => {
    const sun = new SunDisc();
    const mat = discMesh(sun).material as THREE.MeshBasicMaterial;
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
});
