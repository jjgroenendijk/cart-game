import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeCel, type CelMaterial } from "../materials/cel";
import { makeRNG } from "../core/rng";

/**
 * Shared prop helpers: the geometry/material assembly plumbing every flora
 * kind reuses. The temperate builders (tree/rock/bush/flower/grass) moved to
 * `../biomes/temperate/flora.ts`; each biome adds its builders in its own
 * `src/biomes/<id>/flora.ts`. This
 * module stays WebGL-free-pure-friendly (no side effects beyond three.js).
 */

export interface BuiltProp {
  geometry: THREE.BufferGeometry;
  material: CelMaterial;
  /** Free the geometry and material this factory allocated. */
  dispose(): void;
}

/**
 * Base dodeca radius for a rock seed. Single source of truth shared by the
 * temperate rock visual builder and the Rapier ball collider so the collider
 * tracks the visible rock bulk (PropField.createBody). Deterministic from the
 * first RNG draw, matching buildRockGeometry's `r`.
 */
export function rockRadius(seed: number): number {
  return makeRNG(seed).range(0.9, 1.8);
}

/**
 * Fraction of the rock radius buried below the placement origin. A noisy
 * dodecahedron rests on a single displaced corner; sinking the bulk makes it
 * read as grounded. Shared by the temperate rock visual builder and the Rapier
 * ball collider (PropField.createBody) so the collider tracks the visible bulk.
 */
export const ROCK_BURY = 0.3;

/**
 * Assemble one BuiltProp: build the geometry, wrap it in a flat-shaded cel
 * material. Returns an object with a dispose that frees both. Used by every
 * flora builder (big per-seed + decor shared-template).
 */
export function buildOnce(
  makeGeo: () => THREE.BufferGeometry,
  celOpts: { color?: number; vertexColors?: boolean },
): BuiltProp {
  const geometry = makeGeo();
  const material = makeCel({ flatShading: true, ...celOpts });
  return {
    geometry,
    material,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// merge/paint helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a part for merging: flatten to NON-indexed (Cylinder/Plane are
 * indexed, Ico/Dodeca are not; mergeGeometries needs consistent indexing),
 * drop `uv` (props are untextured), and bake a uniform LINEAR `color`
 * attribute. Returns the part to use (may be a new geometry when de-indexed).
 */
export function prepPart(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index !== null ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute("uv");
  paintColor(g, hex);
  return g;
}

/**
 * Merge parts (or return the sole part). Disposes inputs on merge. Throws if
 * mergeGeometries returns null so a malformed part set fails loudly.
 */
export function mergeOrFirst(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0]!;
  const merged = mergeGeometries(parts, false);
  disposeAll(parts);
  if (!merged) throw new Error("propFactory: mergeGeometries returned null");
  return merged;
}

function paintColor(geo: THREE.BufferGeometry, hex: number): void {
  const c = new THREE.Color(hex); // sRGB hex -> LINEAR working space
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

function disposeAll(parts: THREE.BufferGeometry[]): void {
  for (const p of parts) p.dispose();
}
