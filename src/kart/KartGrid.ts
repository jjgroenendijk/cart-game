/**
 * 007 starting grid. Computes N spawn poses (pos + yaw) on a 2-column grid
 * behind the start/finish line, on the terrain. Pure-ish: takes a path
 * interface (point + tangent samplers) + a heightAt fn, so it reads terrain
 * geometry only and runs under jsdom with a fake path + fake heightAt.
 *
 * Layout: rows step backwards (against the travel direction) from the start
 * line by a longitudinal gap; each row has up to `columns` karts offset
 * laterally within trackHalfWidth. Y = heightAt(x,z) + clearance; yaw aligns
 * the kart forward (-Z) with the local tangent (matches SplineTrack.startYaw).
 */

import { Vector3 } from "three";
import { DEFAULT_TRACK_HALF_WIDTH } from "../terrain/trackGraph";

/** Minimal path surface KartGrid consumes (SplineTrack satisfies this shape). */
export interface GridPath {
  /** Point on the loop at parameter t in [0,1] (writes into out, returns it). */
  getPoint(t: number, out: Vector3): Vector3;
  /** Unit tangent on the loop at parameter t. */
  getTangent(t: number): Vector3;
}

export interface Spawn {
  pos: Vector3;
  yaw: number;
}

export interface GridOptions {
  /** Karts per row (straddle the centreline). Default 2. */
  columns?: number;
  /** Distance between rows along the loop (m). Default 2.5. */
  longitudinalGap?: number;
  /** Lateral half-offset from the centreline (m). Default 2.0 (< trackHalfWidth). */
  lateral?: number;
  /** Clearance above the terrain (m). Default 0.5. */
  clearance?: number;
  /** Samples for the one-time loop length estimate. Default 256. */
  samples?: number;
}

const DEFAULTS: Required<GridOptions> = {
  columns: 2,
  longitudinalGap: 2.5,
  lateral: 2.0,
  clearance: 0.5,
  samples: 256,
};

/**
 * Compute N grid spawns behind the start line. Deterministic given the path.
 * The caller (Game) maps Spawn[] 1:1 to Kart instances (index 0 = pole).
 */
export function computeGrid(
  path: GridPath,
  heightAt: (x: number, z: number) => number,
  n: number,
  opts: GridOptions = {},
): Spawn[] {
  if (n <= 0) return [];
  const o = { ...DEFAULTS, ...opts };
  const length = estimateLoopLength(path, o.samples);

  const spawns: Spawn[] = [];
  const point = new Vector3();
  const tangent = new Vector3();
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / o.columns);
    const col = i % o.columns;
    const backDist = (row + 1) * o.longitudinalGap;
    // Behind the start line = negative arc offset, wrapped into [0,1).
    const t = wrapLoop(-backDist / length);
    path.getPoint(t, point);
    tangent.copy(path.getTangent(t)).normalize();

    // Right vector (forward x up with up = +Y) for the lateral straddle.
    const rx = -tangent.z;
    const rz = tangent.x;
    const side = o.columns === 1 ? 0 : (2 * col) / (o.columns - 1) - 1;
    const px = point.x + rx * side * o.lateral;
    const pz = point.z + rz * side * o.lateral;

    spawns.push({
      pos: new Vector3(px, heightAt(px, pz) + o.clearance, pz),
      yaw: Math.atan2(-tangent.x, -tangent.z),
    });
  }
  return spawns;
}

/** Total loop length via segment summation over uniform samples. */
function estimateLoopLength(path: GridPath, samples: number): number {
  const a = new Vector3();
  const b = new Vector3();
  path.getPoint(0, a);
  let length = 0;
  for (let i = 1; i <= samples; i++) {
    path.getPoint(i / samples, b);
    length += a.distanceTo(b);
    a.copy(b);
  }
  return length;
}

function wrapLoop(t: number): number {
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

// Re-exported constant for tests that assert spawns stay inside the corridor.
// 059: the source of truth lives in terrain/trackGraph; runtime callers read
// the LOCAL width from a pose instead (FieldBuilder clamps the straddle).
export const TRACK_HALF_WIDTH = DEFAULT_TRACK_HALF_WIDTH;
