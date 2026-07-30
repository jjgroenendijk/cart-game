import * as THREE from "three";
import { makeRNG } from "../../core/rng";
import { type BuiltProp, buildOnce, prepPart, ROCK_BURY } from "../propFactory";
import type { FloraBuilder } from "../floraRegistry";

/**
 * Rock archetypes (split from the single archetypes.ts module; see
 * `./archetypes.ts` for the library overview). Moved verbatim: same knobs,
 * same RNG draw order, same geometry for a given seed.
 *
 *   ballRock -> rock/sandRock/screeRock/iceRock (noisy dodeca)
 */

/** Noisy dodecahedron rock. Big, ball collider sharing the visual radius. */
export interface BallRockConfig {
  rMin?: number;
  rMax?: number;
  /** Rock color (single). */
  color?: number;
  /** Optional y-scale for squashed rocks (e.g. scattered flagstone). */
  flatten?: number;
}

/**
 * Noisy dodecahedron rock: the exact per-corner displacement algorithm shared
 * by rock/sandRock/screeRock/iceRock. Big, ball collider whose radius derives
 * from the same first RNG draw as the visual so the collider tracks the
 * visible bulk. flatten (y-scale) squashes the rock for flagstone reads.
 */
export function ballRock(cfg: BallRockConfig = {}): FloraBuilder {
  const rMin = cfg.rMin ?? 0.9;
  const rMax = cfg.rMax ?? 1.8;
  const color = cfg.color ?? 0x7d8a96;
  const flatten = cfg.flatten;

  // radius(seed) is the single source of truth shared by the visual + the
  // ball collider: both draw the same first RNG value so the collider tracks
  // the visible rock bulk (PropField.createBody parity with bespoke rocks).
  const radius = (seed: number): number => makeRNG(seed).range(rMin, rMax);

  const build = (seed: number): BuiltProp =>
    buildOnce(
      () => {
        const rng = makeRNG(seed);
        // First draw MUST match radius(seed) above.
        const r = rng.range(rMin, rMax);
        const geo = new THREE.DodecahedronGeometry(r, 0);
        if (flatten !== undefined) geo.scale(1, flatten, 1);
        const pos = geo.attributes.position as THREE.BufferAttribute;

        // DodecahedronGeometry is non-indexed: each triangle owns 3 fresh
        // verts, so the ~20 spatial corners are duplicated ~3x. A per-entry RNG
        // scale would tear coincident verts apart -> gaps between every face.
        // Displace by a scale keyed on the quantized base position so shared
        // corners land together and the mesh stays a single closed surface.
        const scaleByKey = new Map<number, number>();
        const keyOf = (x: number, y: number, z: number): number =>
          (Math.round(x * 1e4) * 73856093) ^
          (Math.round(y * 1e4) * 19349663) ^
          (Math.round(z * 1e4) * 83492791);

        const v = new THREE.Vector3();
        let minY = Infinity;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const k = keyOf(v.x, v.y, v.z);
          let d = scaleByKey.get(k);
          if (d === undefined) {
            d = 1 + rng.unit() * 0.3;
            scaleByKey.set(k, d);
          }
          v.multiplyScalar(d);
          pos.setXYZ(i, v.x, v.y, v.z);
          if (v.y < minY) minY = v.y;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        // Author the base below y=0 by ROCK_BURY*r: the lowest displaced
        // corner would otherwise balance the rock on a single point. PropField
        // places the origin at terrain height, so sinking embeds the lower
        // faces into the ground. Track the displaced min Y so the offset is
        // exact.
        geo.translate(0, -minY - r * ROCK_BURY, 0);
        return prepPart(geo, color);
      },
      { vertexColors: true },
    );

  return {
    build,
    big: true,
    collider: { shape: "ball", radius, bury: ROCK_BURY },
    flatShading: true,
  };
}
