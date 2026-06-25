import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial } from "../materials/cel";
import { Clouds } from "./Clouds";
import { dayCycleState } from "./dayCycle";

describe("Clouds", () => {
  it("is an InstancedMesh of the requested count on layer 0", () => {
    const c = new Clouds({ count: 16, puffsPerCloud: 1 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.count).toBe(16);
    expect(mesh.instanceMatrix.count).toBe(16);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    c.dispose();
  });

  it("multi-puff: instance count = count * puffsPerCloud", () => {
    const c = new Clouds({ count: 4, puffsPerCloud: 6 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(24);
    expect(mesh.instanceMatrix.count).toBe(24);
    expect(mesh.instanceMatrix.array.length).toBe(24 * 16);
    c.dispose();
  });

  it("uses a flat-shaded CelMaterial and casts no shadows", () => {
    const c = new Clouds();
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.material).toBeInstanceOf(CelMaterial);
    expect((mesh.material as CelMaterial).flatShading).toBe(true);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    c.dispose();
  });

  it("geometry is a squashed icosahedron (y scale < x/z)", () => {
    const c = new Clouds();
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // Sample bounding box to confirm y is squashed relative to x/z extent.
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const yExt = bb.max.y - bb.min.y;
    const xExt = bb.max.x - bb.min.x;
    expect(yExt).toBeLessThan(xExt * 0.5);
    expect(pos.count).toBeGreaterThan(0);
    c.dispose();
  });

  it("update drifts +X and wraps the group within [-wrap, wrap]", () => {
    const c = new Clouds({ count: 4, driftSpeed: 10 });
    expect(c.group.position.x).toBe(0);
    // Drift past the wrap boundary (half 100 -> wrap 120): 120/10 = 12s.
    c.update(13);
    // After exceeding wrap once, position should be wrapped back by 2*wrap.
    expect(c.group.position.x).toBeLessThanOrEqual(120);
    expect(c.group.position.x).toBeGreaterThan(-240);
    c.dispose();
  });

  it("update always keeps group.position.x within [-wrap, wrap]", () => {
    const c = new Clouds({ count: 4, driftSpeed: 5 });
    let max = -Infinity;
    let min = Infinity;
    for (let t = 0; t < 1000; t += 0.7) {
      c.update(0.7);
      max = Math.max(max, c.group.position.x);
      min = Math.min(min, c.group.position.x);
    }
    expect(max).toBeLessThanOrEqual(120 + 1e-6);
    expect(min).toBeGreaterThanOrEqual(-120 - 1e-6);
    c.dispose();
  });

  it("is deterministic: same seed -> identical instance matrices", () => {
    const a = new Clouds({ count: 8, seed: 42 });
    const b = new Clouds({ count: 8, seed: 42 });
    const ma = (a.group.children[0] as THREE.InstancedMesh).instanceMatrix;
    const mb = (b.group.children[0] as THREE.InstancedMesh).instanceMatrix;
    expect(Array.from(ma.array as Float32Array)).toEqual(Array.from(mb.array as Float32Array));
    a.dispose();
    b.dispose();
  });

  it("density knob scales the default cloud count (0.5 -> 12 clouds)", () => {
    const c = new Clouds({ density: 0.5 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(72); // round(24*0.5)=12 clouds * 6 puffs
    c.dispose();
  });

  it("density knob scales the default cloud count (2 -> 48 clouds)", () => {
    const c = new Clouds({ density: 2 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(288); // round(24*2)=48 clouds * 6 puffs
    c.dispose();
  });

  it("explicit count wins over density", () => {
    const c = new Clouds({ count: 5, density: 2 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(30); // 5 clouds * 6 puffs, NOT 48*6
    c.dispose();
  });

  it("altitude alias places puffs near the given altitude", () => {
    const c = new Clouds({ altitude: 100, count: 1, puffsPerCloud: 1 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    m.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
    expect(Math.abs(pos.y - 100)).toBeLessThan(10); // heightJitter < 10
    c.dispose();
  });

  it("update applies the day-cycle cloud tint from dayCycleState", () => {
    const c = new Clouds();
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    const uColor = (mesh.material as CelMaterial).uniforms.uColor.value as THREE.Color;
    const savedPhase = dayCycleState.phase;
    const savedHorizon = dayCycleState.skyHorizon.clone();
    try {
      const baseBefore = uColor.getHex();
      dayCycleState.phase = "dusk";
      dayCycleState.skyHorizon.set(0xff8050);
      c.update(0.1);
      expect(uColor.getHex()).not.toBe(baseBefore);
    } finally {
      dayCycleState.phase = savedPhase;
      dayCycleState.skyHorizon.copy(savedHorizon);
    }
    c.dispose();
  });

  it("dispose frees geometry + material and is idempotent", () => {
    const c = new Clouds();
    expect(() => c.dispose()).not.toThrow();
    expect(() => c.dispose()).not.toThrow();
  });
});
