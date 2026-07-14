/**
 * Terrain LOD cross-fade primitives (shared by TerrainChunkManager). A chunk's
 * tier swap keeps the old-tier mesh (inverse dither, fading OUT) alongside the
 * new-tier mesh (normal dither, fading IN); both `uFade`s ramp to the same `t`
 * so the two tessellations partition every pixel (no overlap, no depth fight),
 * dissolving the swap through the fog band instead of snapping. See
 * `src/materials/fade.ts` (Bayer discard) + cel.ts `fade`/`fadeInvert`.
 */

import * as THREE from "three";
import type { CelMaterial } from "../materials/cel";
import { buildMorphTargets, type ChunkRect } from "./chunkBuilder";
import type { HeightSource } from "./heightSource";

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

/**
 * Advance one fade by `step`, write both uFades, and (when the geomorph
 * uniform is present) both uMorphs: the outgoing mesh morphs toward the new
 * tier as t->1 (uMorph=t), the incoming mesh morphs FROM the old tier
 * (uMorph=1-t), so at the swap both are geometrically the other tier. Returns
 * true at completion.
 */
export function stepCrossFade(x: CrossFade, step: number): boolean {
  x.t = Math.min(1, x.t + step);
  x.oldMat.uniforms.uFade.value = x.t;
  x.newMat.uniforms.uFade.value = x.t;
  if (x.oldMat.uniforms.uMorph) x.oldMat.uniforms.uMorph.value = x.t;
  if (x.newMat.uniforms.uMorph) x.newMat.uniforms.uMorph.value = 1 - x.t;
  return x.t >= 1;
}

/**
 * Attach the geomorph target attribute (`aMorphTarget`: per-vertex height under
 * `otherSeg`'s tessellation) to a cross-fade mesh geometry so the vertex shader
 * (GEOMORPH) can slide its silhouette toward the adjacent tier. Pure height
 * sampling via `src.heightAt` — the collider + heightAt are never touched.
 */
export function attachMorphTarget(
  geometry: THREE.BufferGeometry,
  rect: ChunkRect,
  otherSeg: number,
  src: HeightSource,
): void {
  const pos = geometry.attributes.position!.array as Float32Array;
  const morph = buildMorphTargets(pos, rect, otherSeg, src);
  geometry.setAttribute("aMorphTarget", new THREE.BufferAttribute(morph, 1));
}

/** Remove + dispose the outgoing (old-tier) half; caller owns the survivor. */
export function removeOutgoing(group: THREE.Group, x: CrossFade): void {
  group.remove(x.oldMesh);
  x.oldMesh.geometry.dispose();
  x.oldMat.dispose();
}
