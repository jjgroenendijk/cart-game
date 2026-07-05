/**
 * 060 track marker data shape. Markers are edge-local annotations (future
 * items/boost pads); ONLY the shape + world-pose helper land with 060 —
 * every circuit ships an empty marker list. Pure (no three), jsdom-safe.
 */

import type { TrackGraph } from "./trackGraph";

export interface TrackMarker {
  /** Owning edge (0 = mainline; branches by id). */
  edgeId: number;
  /** Arc position along the edge (m). */
  s: number;
  /** Lateral offset from the centerline (m); + = right of travel. */
  lateral: number;
  /** Consumer-defined kind label (e.g. "boost", "item"). */
  kind: string;
}

export interface MarkerPose {
  x: number;
  y: number;
  z: number;
  /** Yaw aligning forward (-Z) with the edge tangent (kart convention). */
  yaw: number;
}

/**
 * World pose for a marker: centerline point + lateral offset along the edge
 * right vector (right = (-tz, tx), matching KartGrid), y from the edge
 * centerline (callers snap to terrain height when placing visuals).
 */
export function markerWorldPose(graph: TrackGraph, marker: TrackMarker): MarkerPose {
  const e = graph.edgeById(marker.edgeId);
  const p = e.pointAt(marker.s);
  const tan = e.tangentAt(marker.s);
  const len = Math.hypot(tan.x, tan.z) || 1;
  const rx = -tan.z / len;
  const rz = tan.x / len;
  return {
    x: p.x + rx * marker.lateral,
    y: p.y,
    z: p.z + rz * marker.lateral,
    yaw: Math.atan2(-tan.x, -tan.z),
  };
}
