import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial } from "../materials/cel";
import {
  buildBush,
  buildFlower,
  buildGrass,
  buildRock,
  buildTree,
  type BuiltProp,
} from "./propFactory";

const hasAttr = (g: THREE.BufferGeometry, name: string): boolean =>
  g.attributes[name] !== undefined;

describe("propFactory — per-type geometry + cel material", () => {
  it("tree: merged geometry, position+color, base near y=0, flat cel", () => {
    const { geometry, material } = buildTree(1);
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
    expect(hasAttr(geometry, "color")).toBe(true);
    // Trunk base authored at y=0.
    const y = geometry.attributes.position as THREE.BufferAttribute;
    expect(Math.min(...sampleY(y))).toBeGreaterThanOrEqual(-0.01);
    expect(material).toBeInstanceOf(CelMaterial);
    expect(material.flatShading).toBe(true);
    expect(material.vertexColors).toBe(true);
  });

  it("rock: dodecahedron geometry, vertex-colored, flatShaded cel", () => {
    const { geometry, material } = buildRock(2);
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
    expect(hasAttr(geometry, "color")).toBe(true);
    expect(material).toBeInstanceOf(CelMaterial);
    expect(material.flatShading).toBe(true);
    expect(material.vertexColors).toBe(true);
  });

  it("bush: shared geometry, single-colour cel (no vertexColors needed)", () => {
    const { geometry, material } = buildBush();
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
    expect(material).toBeInstanceOf(CelMaterial);
    expect(material.flatShading).toBe(true);
    expect(material.vertexColors).toBe(false);
  });

  it("flower: merged stem+petal geometry with vertex colors", () => {
    const { geometry, material } = buildFlower();
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
    expect(hasAttr(geometry, "color")).toBe(true);
    expect(material.flatShading).toBe(true);
    expect(material.vertexColors).toBe(true);
  });

  it("grass: merged crossed blades with vertex colors", () => {
    const { geometry, material } = buildGrass();
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
    expect(hasAttr(geometry, "color")).toBe(true);
    expect(material.flatShading).toBe(true);
    expect(material.vertexColors).toBe(true);
  });
});

describe("propFactory — determinism + variety", () => {
  it("same seed builds identical tree geometry", () => {
    const a = buildTree(42);
    const b = buildTree(42);
    const pa = a.geometry.attributes.position.array as Float32Array;
    const pb = b.geometry.attributes.position.array as Float32Array;
    expect(Array.from(pa)).toEqual(Array.from(pb));
    a.dispose();
    b.dispose();
  });

  it("different seeds produce different trees (variety)", () => {
    const a = buildTree(1);
    const b = buildTree(2);
    const pa = a.geometry.attributes.position.array as Float32Array;
    const pb = b.geometry.attributes.position.array as Float32Array;
    expect(Array.from(pa)).not.toEqual(Array.from(pb));
    a.dispose();
    b.dispose();
  });

  it("shared decor builders are stable across calls (InstancedMesh-ready)", () => {
    const a = buildGrass();
    const b = buildGrass();
    expect(a.geometry.uuid).not.toBe(b.geometry.uuid); // fresh each call
    expect(a.geometry.attributes.position.count).toBe(b.geometry.attributes.position.count);
    a.dispose();
    b.dispose();
  });
});

describe("propFactory — dispose + material contract", () => {
  it("dispose frees geometry + material without throwing", () => {
    const built: BuiltProp[] = [
      buildTree(1),
      buildRock(2),
      buildBush(),
      buildFlower(),
      buildGrass(),
    ];
    for (const b of built) expect(() => b.dispose()).not.toThrow();
  });

  it("dispose is idempotent", () => {
    const b = buildTree(3);
    b.dispose();
    expect(() => b.dispose()).not.toThrow();
  });

  it("all materials are CelMaterial (never MeshStandardMaterial)", () => {
    const built = [buildTree(1), buildRock(2), buildBush(), buildFlower(), buildGrass()];
    for (const b of built) {
      expect(b.material).toBeInstanceOf(CelMaterial);
      expect(b.material.isShaderMaterial).toBe(true);
      b.dispose();
    }
  });

  it("vertex color attribute holds LINEAR values (<=1, not raw 0..255)", () => {
    const { geometry } = buildTree(1);
    const col = geometry.attributes.color as THREE.BufferAttribute;
    let max = 0;
    for (let i = 0; i < col.count * 3; i++) max = Math.max(max, col.array[i]!);
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(0);
  });
});

function sampleY(attr: THREE.BufferAttribute, n = 200): number[] {
  const step = Math.max(1, Math.floor(attr.count / n));
  const out: number[] = [];
  for (let i = 0; i < attr.count; i += step) out.push(attr.getY(i));
  return out;
}
