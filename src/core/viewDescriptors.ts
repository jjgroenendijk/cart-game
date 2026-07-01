/**
 * ViewDescriptor pool sync for renderViews. Grows/truncates the pooled array
 * to match the live PlayerView count, then refreshes camera + rect refs.
 * Mutates + returns the same `descs` array (no per-frame allocation).
 * Pure over its inputs (no module state); extracted from Game byte-for-byte.
 */

import type { ViewDescriptor } from "./Renderer";
import type { PlayerView } from "./PlayerView";

export function syncViewDescs(descs: ViewDescriptor[], views: PlayerView[]): ViewDescriptor[] {
  const n = views.length;
  while (descs.length < n) {
    const v = views[0]!;
    descs.push({ camera: v.chaseCam.camera, rect: v.rect });
  }
  descs.length = n;
  for (let i = 0; i < n; i++) {
    const v = views[i]!;
    const d = descs[i]!;
    d.camera = v.chaseCam.camera;
    d.rect = v.rect;
  }
  return descs;
}
