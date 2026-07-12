import * as THREE from "three";
import { type BuiltProp, buildOnce } from "../propFactory";
import type { FloraBuilder } from "../floraRegistry";

/**
 * Shrub archetypes (split from the single archetypes.ts module; see
 * `./archetypes.ts` for the library overview). Moved verbatim: same knobs,
 * same geometry.
 *
 *   lumpyShrub -> bush/dryShrub/lichenBush/snowBush (squashed ico)
 *
 * Decor builders ignore the seed arg (shared template for an InstancedMesh) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Squashed icosahedron shrub. Decor (big=false), collider none. */
export interface LumpyShrubConfig {
  r?: number;
  /** Y-scale squash (lower = hugging the ground). */
  squashY?: number;
  color?: number;
  /** Vertical offset (lifts the base off the ground). */
  yOffset?: number;
}

/**
 * Squashed icosahedron shrub (bush/dry/lichen/snow read). Decor (big=false),
 * collider none. Shared template — ignores seed for an InstancedMesh.
 */
export function lumpyShrub(cfg: LumpyShrubConfig = {}): FloraBuilder {
  const r = cfg.r ?? 0.9;
  const squashY = cfg.squashY ?? 0.7;
  const color = cfg.color ?? 0x4f7a3a;
  const yOffset = cfg.yOffset ?? 0.45;

  const build = (): BuiltProp =>
    buildOnce(
      () => {
        const geo = new THREE.IcosahedronGeometry(r, 0);
        geo.scale(1, squashY, 1);
        geo.translate(0, yOffset, 0);
        return geo;
      },
      { color },
    );

  return { build, big: false, collider: { shape: "none" } };
}
