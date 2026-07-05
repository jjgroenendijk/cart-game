/**
 * 060 route-aware helpers over the track graph. Pure (no Game/physics/DOM;
 * plain {x,y,z} points) -> jsdom-testable. FieldBuilder applies the returned
 * poses to Rapier bodies and feeds the samples to AiDriver.
 *
 * A route is described by a RoutePlan: branch edge id -> take? Walking the
 * plan is edge-local: on the mainline a taken split diverts the cursor onto
 * the branch at its entry; a branch that runs out continues on the mainline
 * past its merge node. Respawn walks with NO plan (continue the current
 * edge), so a kart on a branch respawns ON that branch and past the merge it
 * is back on the mainline — exactly what a stuck kart expects.
 */

import type { AiSplinePoint } from "./AiDriver";
import type { GraphPose, TrackGraph } from "../terrain/trackGraph";

/** Branch edge id -> whether this route takes it. */
export type RoutePlan = ReadonlyMap<number, boolean>;

/** Respawn distance along the edge past the kart's nearest station (m). */
export const RESPAWN_AHEAD_M = 15;

/** Mutable edge-local cursor for route walking. */
export interface RouteCursor {
  edgeId: number;
  s: number;
}

/**
 * Advance `cur` by `meters` of arc along the planned route (mutates + returns
 * it). Mainline: the first taken split within reach diverts onto its branch;
 * branch: past the end, continue on the mainline at the merge node. The
 * guard bounds edge transitions per call (routes never need more than a few).
 */
export function advanceOnRoute(
  graph: TrackGraph,
  plan: RoutePlan | undefined,
  cur: RouteCursor,
  meters: number,
): RouteCursor {
  const L = graph.loopLength;
  let remaining = meters;
  let guard = 8;
  while (remaining > 1e-9 && guard-- > 0) {
    const e = graph.edgeById(cur.edgeId);
    if (!e.closed) {
      const room = e.length - cur.s;
      if (remaining < room) {
        cur.s += remaining;
        return cur;
      }
      remaining -= room;
      cur.edgeId = 0;
      cur.s = wrapArc(e.tB * L, L);
      continue;
    }
    // Mainline: find the nearest taken split ahead within reach.
    let bestDelta = Infinity;
    let bestEdge = -1;
    for (const b of graph.edges) {
      if (b.closed || !(plan?.get(b.id) ?? false)) continue;
      const delta = wrapArc(b.tA * L - cur.s, L);
      if (delta > 1e-9 && delta < bestDelta) {
        bestDelta = delta;
        bestEdge = b.id;
      }
    }
    if (bestEdge >= 0 && bestDelta <= remaining) {
      remaining -= bestDelta;
      cur.edgeId = bestEdge;
      cur.s = 0;
      continue;
    }
    cur.s = wrapArc(cur.s + remaining, L);
    return cur;
  }
  return cur;
}

/**
 * Fill `buf` with route-following lookahead samples spaced `stepM` apart,
 * starting one step past (edgeId, s). Writes {x, z, halfWidth} per slot
 * (AiDriver's horizon shape); allocation-free given a pooled scratch point.
 */
export function samplePathAhead(
  graph: TrackGraph,
  plan: RoutePlan | undefined,
  edgeId: number,
  s: number,
  stepM: number,
  buf: AiSplinePoint[],
  scratch: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): AiSplinePoint[] {
  const cur: RouteCursor = { edgeId, s };
  for (let i = 0; i < buf.length; i++) {
    advanceOnRoute(graph, plan, cur, stepM);
    const e = graph.edgeById(cur.edgeId);
    e.pointAt(cur.s, scratch);
    const slot = buf[i]!;
    slot.x = scratch.x;
    slot.z = scratch.z;
    slot.halfWidth = e.halfWidthAt(cur.s);
  }
  return buf;
}

/** Minimal world surface the respawn helper needs (Terrain satisfies it). */
export interface GraphWorld {
  readonly graph: TrackGraph;
  graphPose(x: number, z: number, out?: GraphPose): GraphPose;
  heightAt(x: number, z: number): number;
}

export interface RespawnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Edge-local respawn pose ahead of the kart's nearest centerline station:
 * on the kart's OWN edge (a kart lost beside a branch respawns on that
 * branch), continuing onto the mainline past the merge node. Yaw aligns
 * kart forward (-Z) with the edge tangent; `clearance` lifts off the
 * surface.
 */
export function respawnPoseOnGraph(
  world: GraphWorld,
  x: number,
  z: number,
  clearance: number,
  aheadM: number = RESPAWN_AHEAD_M,
): RespawnPose {
  const pose = world.graphPose(x, z);
  const cur: RouteCursor = { edgeId: pose.edgeId, s: pose.s };
  advanceOnRoute(world.graph, undefined, cur, aheadM);
  const e = world.graph.edgeById(cur.edgeId);
  const p = e.pointAt(cur.s);
  const tan = e.tangentAt(cur.s);
  return {
    x: p.x,
    y: world.heightAt(p.x, p.z) + clearance,
    z: p.z,
    yaw: Math.atan2(-tan.x, -tan.z),
  };
}

function wrapArc(s: number, length: number): number {
  const w = s % length;
  return w < 0 ? w + length : w;
}
