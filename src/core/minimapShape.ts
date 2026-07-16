/**
 * 060 world-space minimap shape: sampled closed mainline + one open polyline
 * per branch edge (decimated station tables). Pure geometry read off Terrain;
 * split out of Game to keep the orchestrator under the file cap.
 */

import type { Terrain } from "../terrain/Terrain";
import type { MinimapShape } from "../ui/Minimap";

export function buildMinimapShape(terrain: Terrain, samples: number): MinimapShape {
  const main: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < samples; i++) {
    const p = terrain.spline.getPoint(i / samples);
    main.push({ x: p.x, z: p.z });
  }
  const branches = terrain.graph.edges
    .filter((e) => !e.closed)
    .map((e) => {
      const pts: Array<{ x: number; z: number }> = [];
      const stride = Math.max(1, Math.floor(e.count / 32));
      for (let i = 0; i < e.count; i += stride) pts.push({ x: e.sx[i]!, z: e.sz[i]! });
      pts.push({ x: e.sx[e.count - 1]!, z: e.sz[e.count - 1]! });
      return pts;
    });
  return { main, branches };
}
