/**
 * 202 collider-range planner. Pure reconcile step layered over streamGrid's
 * `nearestFocusDistanceXZ`: given a subsystem's active chunks (as `center` +
 * `collidersOn` views) and the collider foci (kart/AI positions), it computes
 * which chunks should enable/disable their trimesh collider this tick. Mirrors
 * `planStream` in `chunkStream.ts`: owns range selection only — no meshes, no
 * Rapier; lifecycle (enable/disable hooks) stays in the subsystem.
 *
 * Two radii give hysteresis: a chunk enables once inside `colliderRadius` and
 * only disables past `colliderCullRadius` (>= colliderRadius), so an edge
 * chunk does not flap. Distances are XZ-only (Y ignored), matching the visual
 * stream planner.
 *
 * Pure (numbers + chunk views in, plain lists out); runs under jsdom.
 */

import type { Pt } from "../kart/kartLod";
import { nearestFocusDistanceXZ } from "./streamGrid";

/** Read-only chunk view the planner reads: world center + collider on flag. */
export interface ColliderChunk {
  center: Pt;
  collidersOn: boolean;
}

/** One tick's collider reconcile plan. Both lists are never null. */
export interface ColliderRefreshPlan<T extends ColliderChunk> {
  /** Off-range chunks now inside colliderRadius (enable their trimesh). */
  enable: T[];
  /** On-range chunks now past colliderCullRadius (disable their trimesh). */
  disable: T[];
}

/** XZ distance from `center` to the nearest collider focus. Pure. */
export function colliderFocusDistance(center: Pt, foci: readonly Pt[]): number {
  return nearestFocusDistanceXZ(center.x, center.z, foci);
}

/**
 * Reconcile `chunks` against `foci` under the two collider radii. Returns
 * chunks to enable (off -> inside `radius`) and to disable (on -> past
 * `cullRadius`). The radius/cullRadius comparison order is the 202
 * hysteresis and is load-bearing. Empty foci -> empty plan.
 */
export function planColliderRefresh<T extends ColliderChunk>(
  chunks: Iterable<T>,
  foci: readonly Pt[],
  radius: number,
  cullRadius: number,
): ColliderRefreshPlan<T> {
  const enable: T[] = [];
  const disable: T[] = [];
  if (foci.length === 0) return { enable, disable };
  for (const c of chunks) {
    const d = colliderFocusDistance(c.center, foci);
    if (!c.collidersOn && d <= radius) {
      enable.push(c);
    } else if (c.collidersOn && d > cullRadius) {
      disable.push(c);
    }
  }
  return { enable, disable };
}
