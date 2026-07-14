/**
 * Terrain LOD cross-fade primitives (shared by TerrainChunkManager). A chunk's
 * tier swap keeps the old-tier mesh (inverse dither, fading OUT) alongside the
 * new-tier mesh (normal dither, fading IN); both `uFade`s ramp to the same `t`
 * so the two tessellations partition every pixel (no overlap, no depth fight),
 * dissolving the swap through the fog band instead of snapping. See
 * `src/materials/fade.ts` (Bayer discard) + cel.ts `fade`/`fadeInvert`.
 */

import type * as THREE from "three";
import type { CelMaterial } from "../materials/cel";

/** In-flight cross-fade state for one chunk (stored on its ChunkState). */
export interface CrossFade {
  /** Outgoing mesh (old tier, inverse-fade material). */
  oldMesh: THREE.Mesh;
  /** Old-tier fade material (dissolves OUT as t->1). */
  oldMat: CelMaterial;
  /** New-tier fade material on the surviving mesh (dissolves IN as t->1). */
  newMat: CelMaterial;
  /** Progress 0..1. */
  t: number;
}

/** Default monotonic clock in seconds (performance.now, Date.now fallback). */
export function defaultNow(): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}

/** Advance one fade by `step`, write both uFades, return true at completion. */
export function stepCrossFade(x: CrossFade, step: number): boolean {
  x.t = Math.min(1, x.t + step);
  x.oldMat.uniforms.uFade.value = x.t;
  x.newMat.uniforms.uFade.value = x.t;
  return x.t >= 1;
}

/** Remove + dispose the outgoing (old-tier) half; caller owns the survivor. */
export function removeOutgoing(group: THREE.Group, x: CrossFade): void {
  group.remove(x.oldMesh);
  x.oldMesh.geometry.dispose();
  x.oldMat.dispose();
}
