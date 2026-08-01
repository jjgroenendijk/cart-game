import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildKartVisual, disposeKartVisual } from "./kartVisual";
import type { CelMaterial } from "../materials/cel";

const COLORS = { body: 0xcc3322, accent: 0x2244cc };

const build = (): THREE.Group => {
  const group = new THREE.Group();
  buildKartVisual(group, "balanced", COLORS);
  return group;
};

const isEnv = (m: THREE.Material): boolean => (m as CelMaterial).defines?.ENV_REFLECT === "";

describe("buildKartVisual — 243 env reflection wiring", () => {
  it("body + accent materials carry ENV_REFLECT; dark material does not", () => {
    const g = build();
    const assigned = new Set<THREE.Material>();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material;
      if (Array.isArray(m)) for (const mm of m) assigned.add(mm);
      else if (m) assigned.add(m);
    });

    const body = [...assigned].find(
      (m) => (m as CelMaterial).uniforms?.uColor?.value.getHex() === COLORS.body,
    ) as CelMaterial;
    const accent = [...assigned].find(
      (m) => (m as CelMaterial).uniforms?.uColor?.value.getHex() === COLORS.accent,
    ) as CelMaterial;
    const dark = [...assigned].find(
      (m) => (m as CelMaterial).uniforms?.uColor?.value.getHex() === 0x1a1a1f,
    ) as CelMaterial;

    expect(body).toBeTruthy();
    expect(accent).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(isEnv(body)).toBe(true);
    expect(isEnv(accent)).toBe(true);
    expect(isEnv(dark)).toBe(false);
  });

  it("envReflect materials use envStrength 0.3 + uEnvRoughness 0.4", () => {
    const g = build();
    const accent = findMat(g, COLORS.accent);
    expect(accent.uniforms.uEnvStrength?.value).toBe(0.3);
    expect(accent.uniforms.uEnvRoughness?.value).toBeCloseTo(0.4, 6);
  });

  it("tags env-reflect meshes with a full (reflective) + lod (off) variant", () => {
    const g = build();
    let tagged = 0;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const ud = mesh.userData;
      if (!ud.kartMatFull || !ud.kartMatLod) return;
      tagged++;
      expect(isEnv(ud.kartMatFull as THREE.Material)).toBe(true);
      expect(isEnv(ud.kartMatLod as THREE.Material)).toBe(false);
    });
    // Body + accent meshes exist on the chassis alone; at least one of each.
    expect(tagged).toBeGreaterThan(0);
  });

  it("dark/tire meshes get no swap userData", () => {
    const g = build();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as CelMaterial;
      if (m?.uniforms?.uColor?.value.getHex() === 0x1a1a1f) {
        expect(mesh.userData.kartMatFull).toBeUndefined();
        expect(mesh.userData.kartMatLod).toBeUndefined();
      }
    });
  });

  it("disposeKartVisual frees the stashed LOD variants too (no leak)", () => {
    const g = build();
    const lodVariant = findMat(g, COLORS.body, "lod");
    expect(lodVariant).toBeTruthy();
    // While at "full" LOD the lod variant is NOT assigned to any mesh, so a
    // naive dispose (assigned materials only) would leak it. disposeKartVisual
    // must collect it from userData.
    let assigned = false;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material === lodVariant) assigned = true;
    });
    expect(assigned).toBe(false);
    const spy = trackDispose(lodVariant);
    disposeKartVisual(g);
    expect(spy.called).toBe(true);
  });
});

function findMat(g: THREE.Group, hex: number, kind: "full" | "lod" = "full"): CelMaterial {
  let found: CelMaterial | undefined;
  g.traverse((o) => {
    if (found) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const cand = (kind === "lod" ? mesh.userData.kartMatLod : mesh.userData.kartMatFull) as
      CelMaterial | undefined;
    if (cand?.uniforms?.uColor?.value.getHex() === hex) found = cand;
  });
  return found!;
}

function trackDispose(m: THREE.Material): { called: boolean } {
  const spy = { called: false };
  const orig = m.dispose.bind(m);
  m.dispose = () => {
    spy.called = true;
    orig();
  };
  return spy;
}
