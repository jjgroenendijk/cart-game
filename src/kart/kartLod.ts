/**
 * 011 distance-based kart shadow + detail LOD. Pure mapping from a kart's
 * distance to the nearest active camera to a level ("full" | "reduced" |
 * "minimal") plus the derived flags castShadow + detail. Default bands:
 * <25 m full (shadow on + detail meshes visible); 25-70 m reduced (shadow
 * on, detail off); >70 m minimal (shadow off, detail off). The kart itself
 * is NEVER hidden at any level — only its detail meshes + shadow toggle —
 * so the race stays visible at every distance.
 *
 * kartLod is pure (numbers in, plain object out) and runs under jsdom.
 * nearestCameraDistance is pure so the 1P (one cam) vs 2P split (two cams)
 * "min across active cameras" rule is unit-testable without WebGL.
 * applyKartLodGroup walks a live THREE group and sets each descendant
 * mesh's castShadow + (for tagged detail meshes) visible; it is allocation-
 * free. Renderer.applyKartLod is the per-frame entry point; Kart.applyLod
 * is a thin delegate.
 */

import type { Mesh, Object3D } from "three";

export type KartLodLevel = "full" | "reduced" | "minimal";

export interface KartLodResult {
  level: KartLodLevel;
  castShadow: boolean;
  detail: boolean;
}

export interface KartLodOpts {
  near?: number;
  mid?: number;
  hysteresis?: number;
}

export const DEFAULT_KART_LOD: Required<KartLodOpts> = {
  near: 25,
  mid: 70,
  hysteresis: 5,
};

export interface Pt {
  x: number;
  y: number;
  z: number;
}

/**
 * Resolve a kart's LOD level + derived flags from its distance to the nearest
 * camera. With no prevLevel, uses raw thresholds: < near -> full; < mid ->
 * reduced; else minimal. With prevLevel set, applies hysteresis at each
 * threshold so the level cannot flap when the kart sits on a band edge:
 * full holds until near + hys; reduced holds between near - hys and
 * mid + hys; minimal holds until mid - hys. castShadow is true for full +
 * reduced (minimal drops the shadow); detail is true only for full. Pure.
 */
export function kartLod(
  distance: number,
  prevLevel?: KartLodLevel,
  opts?: KartLodOpts,
): KartLodResult {
  const near = opts?.near ?? DEFAULT_KART_LOD.near;
  const mid = opts?.mid ?? DEFAULT_KART_LOD.mid;
  const hysteresis = opts?.hysteresis ?? DEFAULT_KART_LOD.hysteresis;
  let level: KartLodLevel;
  if (prevLevel === undefined) {
    level = distance < near ? "full" : distance < mid ? "reduced" : "minimal";
  } else if (prevLevel === "full") {
    level = distance < near + hysteresis ? "full" : distance < mid ? "reduced" : "minimal";
  } else if (prevLevel === "reduced") {
    level =
      distance < near - hysteresis ? "full" : distance > mid + hysteresis ? "minimal" : "reduced";
  } else {
    level = distance > mid - hysteresis ? "minimal" : distance < near ? "full" : "reduced";
  }
  const castShadow = level !== "minimal";
  const detail = level === "full";
  return { level, castShadow, detail };
}

/**
 * Min Euclidean distance from p to any camera in cams, or Infinity when cams
 * is empty. Lets the "nearest of 1P (one cam) or 2P split (two cams)" rule
 * live in a pure, WebGL-free helper. Pure.
 */
export function nearestCameraDistance(p: Pt, cams: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i]!;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dz = p.z - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Apply a resolved LOD result to a kart group in place. Stashes the level on
 * group.userData.lod (the next frame's prevLevel); for each descendant mesh
 * sets castShadow from res.castShadow, and if the mesh is tagged
 * userData.kartDetail === true toggles visible from res.detail. Allocation-
 * free: mutates existing objects only. Tagged detail meshes are the 4 spokes
 * per wheel plus the two wing struts (see Kart.buildWheel + buildMesh).
 */
export function applyKartLodGroup(group: Object3D, res: KartLodResult): void {
  group.userData.lod = res.level;
  group.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = res.castShadow;
      if (o.userData.kartDetail === true) o.visible = res.detail;
    }
  });
}
