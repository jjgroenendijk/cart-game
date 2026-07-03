import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { KartVfx, makeVfxSample, type KartVfxSample } from "./KartVfxLayer";
import { VFX_BUDGET } from "./kartVfx";
import { lightUniforms } from "../materials/lightUniforms";

function points(vfx: KartVfx): THREE.Points {
  const pts = vfx.group.children.find((c) => c instanceof THREE.Points);
  if (!pts) throw new Error("no THREE.Points child");
  return pts as THREE.Points;
}

function material(vfx: KartVfx): THREE.ShaderMaterial {
  return points(vfx).material as THREE.ShaderMaterial;
}

function geometry(vfx: KartVfx): THREE.BufferGeometry {
  return points(vfx).geometry;
}

function posAttr(vfx: KartVfx): Float32Array {
  return geometry(vfx).getAttribute("position").array as Float32Array;
}

const EXPECTED_ATTRS: ReadonlyArray<{ name: string; itemSize: number }> = [
  { name: "position", itemSize: 3 },
  { name: "velocity", itemSize: 3 },
  { name: "birth", itemSize: 1 },
  { name: "life", itemSize: 1 },
  { name: "sizeStart", itemSize: 1 },
  { name: "growth", itemSize: 1 },
  { name: "tint", itemSize: 3 },
  { name: "fadeSteps", itemSize: 1 },
];

describe("KartVfx construction", () => {
  it("puts exactly one THREE.Points in group on layer 0", () => {
    const vfx = new KartVfx({ kartCount: 2, tier: "low", seed: 0 });
    const ptsChildren = vfx.group.children.filter((c) => c instanceof THREE.Points);
    expect(ptsChildren.length).toBe(1);
    expect(points(vfx).layers.isEnabled(0)).toBe(true);
    vfx.dispose();
  });

  it("geometry has all 8 attributes with correct itemSize", () => {
    const vfx = new KartVfx({ kartCount: 2, tier: "low", seed: 0 });
    const geo = geometry(vfx);
    for (const { name, itemSize } of EXPECTED_ATTRS) {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute;
      expect(attr).toBeInstanceOf(THREE.BufferAttribute);
      expect(attr.itemSize).toBe(itemSize);
      expect(attr.count).toBe(VFX_BUDGET.low);
    }
    vfx.dispose();
  });

  it("default tier (high) capacity = VFX_BUDGET.high", () => {
    const vfx = new KartVfx({ kartCount: 6 });
    const attr = geometry(vfx).getAttribute("position") as THREE.BufferAttribute;
    expect(attr.count).toBe(VFX_BUDGET.high);
    vfx.dispose();
  });

  it("material is ShaderMaterial: transparent, depthWrite false, fog true", () => {
    const vfx = new KartVfx({ kartCount: 2, tier: "low", seed: 0 });
    const mat = material(vfx);
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.fog).toBe(true);
    vfx.dispose();
  });
});

describe("KartVfx shader source", () => {
  it("vertex shader ages/moves/grows via uTime", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    const vs = material(vfx).vertexShader;
    expect(vs).toContain("uTime - birth");
    expect(vs).toContain("position + velocity");
    expect(vs).toContain("sizeStart * (1.0 + (growth - 1.0)");
    expect(vs).toContain("gl_PointSize");
    vfx.dispose();
  });

  it("fragment shader: soft disc, quantized fade, ambient, fog", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    const fs = material(vfx).fragmentShader;
    expect(fs).toContain("smoothstep(0.3, 0.5");
    expect(fs).toContain("floor(vT * vFadeSteps)");
    expect(fs).toContain("vTint * uAmbient");
    expect(fs).toContain("mix(c, fogColor");
    vfx.dispose();
  });
});

describe("KartVfx uniforms", () => {
  it("expected defaults: uTime 0, uSizeRange ~300, uAmbient Color", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    const u = material(vfx).uniforms;
    expect(u.uTime.value).toBe(0);
    expect(u.uSizeRange.value).toBeCloseTo(300, 6);
    expect(u.uAmbient.value).toBeInstanceOf(THREE.Color);
    vfx.dispose();
  });

  it("uAmbient mirrors the shared lightUniforms ambient at build", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    const u = material(vfx).uniforms;
    expect((u.uAmbient.value as THREE.Color).getHex()).toBe(lightUniforms.uAmbient.value.getHex());
    vfx.dispose();
  });
});

describe("KartVfx burst (respawn poof)", () => {
  it("burst before update queues a spawn flushed on first update", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    vfx.burst("poof", { x: 5, y: 10, z: 15 });
    vfx.update(0.016, 0.016, []);
    const pos = posAttr(vfx);
    expect(pos[0]).toBe(5);
    expect(pos[1]).toBe(10);
    expect(pos[2]).toBe(15);
    vfx.dispose();
  });
});

describe("KartVfx dust emission", () => {
  it("speed 20 + grounded spawns dust into the ring (non-zero pos)", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    const sample: KartVfxSample = {
      x: 0,
      y: 0,
      z: 0,
      wheels: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 7, y: 0, z: 7 },
        { x: -7, y: 0, z: -7 },
      ],
      speed: 20,
      grounded: true,
      isDrifting: false,
      inWater: false,
      surfaceTint: { r: 0.5, g: 0.5, b: 0.5 },
    };
    // dust rate at 20 m/s grounded = 24/s; dt=0.1 -> 2.4 -> floor 2 spawns
    vfx.update(0.1, 0.1, [sample]);
    const pos = posAttr(vfx);
    expect(pos[0]).not.toBe(0);
    expect(pos[1]).toBe(0);
    expect(pos[2]).not.toBe(0);
    vfx.dispose();
  });
});

describe("KartVfx determinism", () => {
  it("same seed + same (dt, time, samples) -> identical position bytes", () => {
    const sample: KartVfxSample = {
      x: 3,
      y: 1,
      z: 9,
      wheels: [
        { x: 2, y: 0, z: -1 },
        { x: -2, y: 0, z: -1 },
        { x: 2, y: 0, z: 1 },
        { x: -2, y: 0, z: 1 },
      ],
      speed: 25,
      grounded: true,
      isDrifting: true,
      inWater: false,
      surfaceTint: { r: 0.6, g: 0.4, b: 0.2 },
    };
    const a = new KartVfx({ kartCount: 2, tier: "low", seed: 42 });
    const b = new KartVfx({ kartCount: 2, tier: "low", seed: 42 });
    const dt = 0.05;
    const time = 0.05;
    a.update(dt, time, [sample, sample]);
    b.update(dt, time, [sample, sample]);
    const pa = posAttr(a);
    const pb = posAttr(b);
    expect(pb.length).toBe(pa.length);
    for (let i = 0; i < pa.length; i++) expect(pb[i]).toBe(pa[i]);
    a.dispose();
    b.dispose();
  });
});

describe("KartVfx setQuality", () => {
  it('setQuality("low", 6) resizes capacity to VFX_BUDGET.low', () => {
    const vfx = new KartVfx({ kartCount: 6, tier: "high", seed: 0 });
    vfx.setQuality("low", 6);
    const attr = geometry(vfx).getAttribute("position") as THREE.BufferAttribute;
    expect(attr.count).toBe(VFX_BUDGET.low);
    expect(VFX_BUDGET.low).toBe(512);
    vfx.dispose();
  });
});

describe("KartVfx dispose", () => {
  it("empties group.children and disposes geometry + material", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    const pts = points(vfx);
    const geoDispose = vi.spyOn(pts.geometry, "dispose");
    const matDispose = vi.spyOn(pts.material as THREE.Material, "dispose");
    vfx.dispose();
    expect(vfx.group.children.length).toBe(0);
    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });

  it("is idempotent (double dispose does not throw)", () => {
    const vfx = new KartVfx({ kartCount: 1, tier: "low", seed: 0 });
    vfx.dispose();
    expect(() => vfx.dispose()).not.toThrow();
  });
});

describe("makeVfxSample", () => {
  it("returns a sample with 4 wheel slots + surfaceTint", () => {
    const s = makeVfxSample();
    expect(s.wheels.length).toBe(4);
    expect(s.surfaceTint).toEqual({ r: 0, g: 0, b: 0 });
    expect(s.speed).toBe(0);
    expect(s.grounded).toBe(false);
  });
});
