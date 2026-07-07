import { describe, expect, it, beforeAll, vi } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "../terrain/Terrain";
import { TrackDressing } from "./TrackDressing";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

function makeWorld(): { physics: PhysicsWorld; terrain: Terrain; scene: THREE.Scene } {
  const physics = new PhysicsWorld();
  const terrain = new Terrain(physics);
  const scene = new THREE.Scene();
  return { physics, terrain, scene };
}

describe("TrackDressing", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("adds decal + gantry + flag meshes to its group and the scene", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    expect(dressing.group.children.length).toBe(3);
    expect(scene.children).toContain(dressing.group);
    dressing.dispose();
  });

  it("places the decal on layer 1, gantry + flag on layer 0", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    const [decal, gantry, flag] = dressing.group.children as THREE.Mesh[];
    expect(decal.layers.mask & (1 << 1)).toBeTruthy();
    expect(gantry.layers.mask & 1).toBeTruthy();
    expect(flag.layers.mask & 1).toBeTruthy();
    dressing.dispose();
  });

  it("adds exactly two post colliders", () => {
    const { physics, terrain, scene } = makeWorld();
    const before = bodyCount(physics);
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    expect(bodyCount(physics)).toBe(before + 2);
    dressing.dispose();
  });

  it("flag material waves via sin(uTime) and reads light uniforms", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    const flag = dressing.group.children[2] as THREE.Mesh;
    const mat = flag.material as THREE.ShaderMaterial;
    expect(mat.vertexShader).toContain("sin(uTime");
    expect(mat.vertexShader).toContain("aHang");
    expect(mat.uniforms.uAmbient).toBeDefined();
    expect(mat.uniforms.uSunColor).toBeDefined();
    dressing.dispose();
  });

  it("update(time) advances the flag uTime", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    const flag = dressing.group.children[2] as THREE.Mesh;
    const mat = flag.material as THREE.ShaderMaterial;
    dressing.update(42.5);
    expect(mat.uniforms.uTime.value).toBe(42.5);
    dressing.dispose();
  });

  it("flag checker carries both light and dark cells", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    const flag = dressing.group.children[2] as THREE.Mesh;
    const color = (flag.geometry.getAttribute("color") as THREE.BufferAttribute)
      .array as Float32Array;
    const arr = Array.from(color);
    const hasNear = (v: number) => arr.some((c) => Math.abs(c - v) < 0.01);
    expect(hasNear(0.9)).toBe(true);
    expect(hasNear(0.05)).toBe(true);
    dressing.dispose();
  });

  it("decal geometry carries terrain-conformed positions + vertex colors", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    const decal = dressing.group.children[0] as THREE.Mesh;
    const geo = decal.geometry;
    expect(geo.getAttribute("position")).toBeDefined();
    expect(geo.getAttribute("color")).toBeDefined();
    expect(geo.getAttribute("normal")).toBeDefined();
    expect(geo.index?.count).toBeGreaterThan(0);
    dressing.dispose();
  });

  it("dispose frees the post bodies and detaches from the scene", () => {
    const { physics, terrain, scene } = makeWorld();
    const before = bodyCount(physics);
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    expect(bodyCount(physics)).toBe(before + 2);
    dressing.dispose();
    expect(bodyCount(physics)).toBe(before);
    expect(scene.children).not.toContain(dressing.group);
    expect(dressing.group.children.length).toBe(0);
  });

  it("dispose frees the decal + gantry + flag geometries", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    const geos = dressing.group.children.map((m) => (m as THREE.Mesh).geometry);
    const spies = geos.map((g) => vi.spyOn(g, "dispose"));
    dressing.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });

  it("dispose is idempotent", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    dressing.dispose();
    expect(() => dressing.dispose()).not.toThrow();
  });

  it("update after dispose is a no-op (no throw)", () => {
    const { physics, terrain, scene } = makeWorld();
    const dressing = new TrackDressing(scene, terrain, physics, 6);
    dressing.dispose();
    expect(() => dressing.update(1)).not.toThrow();
  });

  it("is deterministic: two builds yield the same decal vertex count", () => {
    const { physics, terrain, scene } = makeWorld();
    const dA = new TrackDressing(scene, terrain, physics, 6);
    const aVerts = (dA.group.children[0] as THREE.Mesh).geometry.getAttribute("position").count;
    dA.dispose();
    const dB = new TrackDressing(scene, terrain, physics, 6);
    const bVerts = (dB.group.children[0] as THREE.Mesh).geometry.getAttribute("position").count;
    expect(bVerts).toBe(aVerts);
    dB.dispose();
  });
});
