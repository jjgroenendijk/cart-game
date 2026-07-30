/**
 * 202 collider-foci pool helper. Terrain + prop colliders track every kart
 * (the single human + AI), not the camera, so a far off-camera rival still
 * keeps ground + prop colliders. The per-frame refresh writes all kart
 * positions into a reused Pt[] pool (no per-frame allocation). Pure: no
 * Three, no DOM.
 */

import type { Pt } from "../kart/kartLod";
import type { PlayerView } from "./PlayerView";
import type { Kart } from "../kart/Kart";

/** Write a position into the pooled foci array at `i`; grow lazily; return i+1. */
function writeFocus(out: Pt[], i: number, src: { x: number; y: number; z: number }): number {
  let slot = out[i];
  if (!slot) {
    slot = { x: 0, y: 0, z: 0 };
    out[i] = slot;
  }
  slot.x = src.x;
  slot.y = src.y;
  slot.z = src.z;
  return i + 1;
}

/** Fill `out` with every kart position (the human view then rivals); returns `out`. */
export function fillKartFoci(out: Pt[], view: PlayerView, rivals: readonly Kart[]): Pt[] {
  let i = 0;
  i = writeFocus(out, i, view.kart.group.position);
  for (const r of rivals) i = writeFocus(out, i, r.group.position);
  out.length = i;
  return out;
}
