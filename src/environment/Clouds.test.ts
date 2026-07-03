import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial } from "../materials/cel";
import { Clouds, recycleAxis } from "./Clouds";
import { dayCycleState } from "./dayCycle";
import { cloudTintFor } from "./cloudTint";

function instanceMesh(c: Clouds): THREE.InstancedMesh {
  return c.group.children[0] as THREE.InstancedMesh;
}

function puffX(mesh: THREE.InstancedMesh, i: number): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return m.elements[12];
}

function allPuffX(mesh: THREE.InstancedMesh): number[] {
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) out.push(puffX(mesh, i));
  return out;
}

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

  it("update keeps the group at origin (per-instance recycle, not rigid follow)", () => {
    const c = new Clouds({ count: 4, driftSpeed: 0 });
    c.update(1, 50, 30);
    expect(c.group.position.x).toBe(0);
    expect(c.group.position.z).toBe(0);
    c.dispose();
  });

  it("update always keeps every puff world X within [-wrap, wrap] at focus 0", () => {
    const c = new Clouds({ count: 4, driftSpeed: 5 });
    const mesh = instanceMesh(c);
    for (let t = 0; t < 400; t += 0.7) {
      c.update(0.7, 0, 0);
      for (const x of allPuffX(mesh)) {
        expect(x).toBeGreaterThanOrEqual(-120 - 1e-6);
        expect(x).toBeLessThan(120 + 1e-6);
      }
    }
    c.dispose();
  });

  it("puffs are world-stationary under a small focus shift (no recycle)", () => {
    const c = new Clouds({ count: 4, puffsPerCloud: 1, driftSpeed: 0, seed: 1 });
    const mesh = instanceMesh(c);
    const before = allPuffX(mesh);
    c.update(1, 5, -5);
    const after = allPuffX(mesh);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBeCloseTo(before[i], 5);
    }
    c.dispose();
  });

  it("puffs recycle ahead when focus leaves them behind (> wrap)", () => {
    const c = new Clouds({ count: 4, puffsPerCloud: 1, driftSpeed: 0, seed: 1 });
    const mesh = instanceMesh(c);
    c.update(1, 300, 0); // focus far ahead: every base is now behind by > wrap
    for (const x of allPuffX(mesh)) {
      expect(x).toBeGreaterThanOrEqual(300 - 120);
      expect(x).toBeLessThan(300 + 120);
    }
    c.dispose();
  });

  it("wind drift advances every puff +X and wraps at span (focus 0)", () => {
    const c = new Clouds({ count: 4, puffsPerCloud: 1, driftSpeed: 10, seed: 1 });
    const mesh = instanceMesh(c);
    const before = allPuffX(mesh);
    c.update(1, 0, 0); // drift 10*1 = 10
    const span = 2 * 120;
    const after = allPuffX(mesh);
    for (let i = 0; i < before.length; i++) {
      const expected = ((((before[i] + 10 + 120) % span) + span) % span) - 120;
      expect(after[i]).toBeCloseTo(expected, 4);
    }
    c.dispose();
  });

  it("setWindMultiplier(3) triples the per-frame drift advance vs multiplier 1", () => {
    const a = new Clouds({ count: 4, puffsPerCloud: 1, driftSpeed: 10, seed: 1 });
    const b = new Clouds({ count: 4, puffsPerCloud: 1, driftSpeed: 10, seed: 1 });
    const ma = instanceMesh(a);
    const mb = instanceMesh(b);
    b.setWindMultiplier(3);
    a.update(1, 0, 0); // drift 10*1*1 = 10
    b.update(1, 0, 0); // drift 10*3*1 = 30
    const xa = puffX(ma, 0);
    const xb = puffX(mb, 0);
    // The drift delta is 3x; wrap keeps both in range, so compare the advance.
    // deltaA = (xa - baseX) wrapped; both share the same base X (seed 1).
    const base = new Clouds({ count: 4, puffsPerCloud: 1, driftSpeed: 0, seed: 1 });
    const baseX = puffX(instanceMesh(base), 0);
    base.dispose();
    const span = 2 * 120;
    const wrap = (v: number) => ((v % span) + span) % span;
    const advA = wrap(xa - baseX);
    const advB = wrap(xb - baseX);
    expect(advB).toBeCloseTo(advA * 3, 3);
    a.dispose();
    b.dispose();
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

  it("density 0 -> 0 clouds (0 instances)", () => {
    const c = new Clouds({ density: 0 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(0);
    expect(mesh.instanceMatrix.count).toBe(0);
    c.dispose();
  });

  it("density 0.49 -> round(24*0.49)=12 clouds * 6 puffs", () => {
    const c = new Clouds({ density: 0.49 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(Math.round(24 * 0.49) * 6);
    expect(mesh.count).toBe(72);
    c.dispose();
  });

  it("altitude wins over cloudHeight when both are set", () => {
    const c = new Clouds({ altitude: 100, cloudHeight: 50, count: 1, puffsPerCloud: 1 });
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    m.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
    expect(Math.abs(pos.y - 100)).toBeLessThan(10);
    expect(Math.abs(pos.y - 50)).toBeGreaterThan(10);
    c.dispose();
  });

  it("tint round-trip: dusk shifts uColor, day returns it to the base tint", () => {
    const c = new Clouds();
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    const uColor = (mesh.material as CelMaterial).uniforms.uColor.value as THREE.Color;
    const savedPhase = dayCycleState.phase;
    const savedHorizon = dayCycleState.skyHorizon.clone();
    try {
      const base = uColor.getHex();
      dayCycleState.phase = "dusk";
      dayCycleState.skyHorizon.set(0xff8050);
      c.update(0.1);
      expect(uColor.getHex()).not.toBe(base);
      dayCycleState.phase = "day";
      c.update(0.1);
      expect(uColor.getHex()).toBe(base);
    } finally {
      dayCycleState.phase = savedPhase;
      dayCycleState.skyHorizon.copy(savedHorizon);
    }
    c.dispose();
  });

  it("first update writes the helper-derived tint at the dawn default", () => {
    const c = new Clouds();
    const mesh = c.group.children[0] as THREE.InstancedMesh;
    const uColor = (mesh.material as CelMaterial).uniforms.uColor.value as THREE.Color;
    const savedPhase = dayCycleState.phase;
    const savedHorizon = dayCycleState.skyHorizon.clone();
    try {
      dayCycleState.phase = "dawn";
      dayCycleState.skyHorizon.set(0xffd0a0);
      const base = new THREE.Color(uColor.getHex());
      const expected = new THREE.Color();
      cloudTintFor("dawn", dayCycleState.skyHorizon, base, expected);
      c.update(0.0);
      expect(uColor.getHex()).toBe(expected.getHex());
      expect(uColor.getHex()).not.toBe(base.getHex());
    } finally {
      dayCycleState.phase = savedPhase;
      dayCycleState.skyHorizon.copy(savedHorizon);
    }
    c.dispose();
  });
});

describe("recycleAxis", () => {
  const half = 120;
  const span = 2 * half;

  it("focus=0 reduces to the origin-anchored wrap", () => {
    const r = recycleAxis(10, 5, 0, half);
    const expected = ((((10 + 5 + half) % span) + span) % span) - half;
    expect(r).toBeCloseTo(expected, 6);
  });

  it("world-stationary: a small focus shift keeps a mid-box point fixed", () => {
    expect(recycleAxis(10, 0, 5, half)).toBeCloseTo(10, 6);
    expect(recycleAxis(-40, 0, 7, half)).toBeCloseTo(-40, 6);
  });

  it("recycles a point left behind past focus-half to ahead of focus", () => {
    const r = recycleAxis(0, 0, 150, half); // base 0 is behind focus 150 by > half
    expect(r).toBeGreaterThanOrEqual(150 - half);
    expect(r).toBeLessThan(150 + half);
    expect(r).toBeCloseTo(0 + span, 6);
  });
});
