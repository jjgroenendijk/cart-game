/**
 * 144 cascade-selection helpers. Pure (no Three/WebGL/DOM) so they run under
 * jsdom unit tests and mirror verbatim in the cel fragment shader.
 *
 * Two cascades: a tight NEAR box (sharp contact shadows) and a wide FAR box
 * (soft middle-distance coverage). A fragment at view-distance `viewDist` from
 * the camera blends near->far across a band ending at `split`. Weight 0 = near,
 * 1 = far. When the far cascade is off (low tier) split/blendWidth are 0 and the
 * weight is always 0 (near-only), matching the pre-144 single-box behavior.
 */

import { clamp } from "./math";

/**
 * Continuous near(0)->far(1) blend weight for a view-space distance. Mirrors the
 * cel fragment shader exactly; keep them in lockstep. blendWidth<=0 -> 0 (single
 * cascade). Clamps to [0,1].
 */
export function cascadeBlendWeight(viewDist: number, split: number, blendWidth: number): number {
  if (blendWidth <= 0) return 0;
  return clamp((viewDist - (split - blendWidth)) / blendWidth, 0, 1);
}

/**
 * Hard cascade pick: 0 = near, 1 = far (weight < 0.5 -> near). Pure; used for
 * any discrete/debug decision. 0 when the far cascade is off (low tier).
 */
export function cascadeFor(viewDist: number, split: number, blendWidth: number): 0 | 1 {
  return cascadeBlendWeight(viewDist, split, blendWidth) < 0.5 ? 0 : 1;
}
