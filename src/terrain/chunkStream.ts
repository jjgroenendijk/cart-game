/**
 * 071 shared streaming planner. Pure reconcile step layered over streamGrid:
 * given a subsystem's currently-active chunk keys and the current active
 * observer focus, it computes which chunks to activate and which to
 * deactivate this tick. It owns chunk-KEY selection
 * only — no meshes, colliders, materials, or particle systems (071 non-goal:
 * lifecycle stays in each subsystem's create/dispose hooks).
 *
 * Two radii give hysteresis: a chunk activates once inside streamRadius of any
 * focus and only deactivates past cullRadius (cullRadius >= streamRadius), so a
 * chunk hovering near the boundary does not flap in/out frame to frame.
 * Activations are ordered nearest-first and capped at maxActivations so a sudden
 * focus jump spreads its cost across ticks (hitch budget) with the closest
 * chunks popping in first. Distances are XZ-only (Y ignored): the planner asks
 * "which world cells exist", independent of camera height.
 *
 * Pure (keys + numbers in, plain coord lists out); runs under jsdom. Each
 * subsystem (WaterChunkManager first; terrain/dressing follow) owns applying the
 * plan against its own active-chunk map.
 */

import type { Pt } from "../kart/kartLod";
import {
  chunkCenter,
  chunkKey,
  desiredChunks,
  nearestFocusDistanceXZ,
  parseChunkKey,
  type GridCoord,
} from "./streamGrid";

/** Shared streaming policy. cullRadius SHOULD be >= streamRadius (hysteresis). */
export interface StreamPolicy {
  /** World-space chunk edge length (metres). */
  chunkSize: number;
  /** Activate chunks within this XZ distance of any focus. */
  streamRadius: number;
  /** Deactivate chunks beyond this XZ distance of every focus. */
  cullRadius: number;
  /** Max new activations returned per plan (hitch budget). */
  maxActivations: number;
}

/** One tick's reconcile plan. Both lists are subsets of the grid, never null. */
export interface StreamPlan {
  /** Desired-not-active chunks, nearest-first, length <= maxActivations. */
  activate: GridCoord[];
  /** Active chunks beyond cullRadius of every focus (order unspecified). */
  deactivate: GridCoord[];
}

/**
 * Reconcile `active` (the subsystem's live chunk keys) against `foci` under
 * `policy`. Returns chunks to activate (nearest-first, capped) and to
 * deactivate (past cullRadius). Empty foci -> empty plan (a transient
 * observerless frame changes nothing rather than nuking every chunk).
 */
export function planStream(
  active: Iterable<string>,
  foci: readonly Pt[],
  policy: StreamPolicy,
): StreamPlan {
  const { chunkSize, streamRadius, cullRadius, maxActivations } = policy;
  const activeSet = active instanceof Set ? active : new Set(active);
  if (foci.length === 0) return { activate: [], deactivate: [] };

  // Deactivate: active chunks whose center is past cullRadius of every focus.
  const deactivate: GridCoord[] = [];
  for (const key of activeSet) {
    const { gx, gz } = parseChunkKey(key);
    const c = chunkCenter(gx, gz, chunkSize);
    if (nearestFocusDistanceXZ(c.x, c.z, foci) > cullRadius) deactivate.push({ gx, gz });
  }

  // Activate: desired-not-active, sorted nearest-first (key tie-break for a
  // deterministic order), then capped at the per-tick budget.
  const desired = desiredChunks(foci, streamRadius, chunkSize);
  const cand: { gx: number; gz: number; d: number; key: string }[] = [];
  for (const key of desired) {
    if (activeSet.has(key)) continue;
    const { gx, gz } = parseChunkKey(key);
    const c = chunkCenter(gx, gz, chunkSize);
    cand.push({ gx, gz, d: nearestFocusDistanceXZ(c.x, c.z, foci), key });
  }
  cand.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cap = Math.max(0, maxActivations);
  const activate = cand.slice(0, cap).map(({ gx, gz }) => ({ gx, gz }));

  return { activate, deactivate };
}

/** Re-export for consumers that key their active-chunk maps via the shared grid. */
export { chunkKey, parseChunkKey };
