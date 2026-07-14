/**
 * 203 HLOD backdrop geometry. Pure builder for the static coarse "backdrop"
 * ring that meshes the world BEYOND the streamed chunk ring — so the horizon
 * reads as real distant terrain (ridgelines/silhouettes) rather than an empty
 * fog wall. It samples the SAME HeightSource the streamed chunks do, so its
 * ridgelines align with the real terrain, but at very coarse tessellation.
 *
 * A polar annulus centered on (centerX, centerZ): `radialSegments+1` rings from
 * innerRadius (meeting the streamed cull ring) out to outerRadius (past the fog
 * horizon), `angularSegments` columns wrapping seamlessly. An optional outer
 * skirt drops the far edge below the surface so the horizon reads solid. Pure
 * (numbers + typed arrays out, no THREE/WebGL) so it runs under jsdom and is
 * fully unit-testable: vertex/triangle counts, height sampling, no collider.
 *
 * INVARIANT: this is a pure VISUAL far mesh — it never feeds a collider,
 * heightAt, or suspension raycast. It only reads `src.heightAt/colorAt/normalAt`.
 */

import type { ChunkGeometry } from "./chunkBuilder";
import type { HeightSource, Rgb, Vec3 } from "./heightSource";

export interface BackdropRingParams {
  /** Ring centre X (world metres) — recentred on the camera focus. */
  centerX: number;
  /** Ring centre Z (world metres). */
  centerZ: number;
  /** Inner radius (metres): meets the streamed cull ring. */
  innerRadius: number;
  /** Outer radius (metres): past the fog horizon so it hazes fully out. */
  outerRadius: number;
  /** Radial vertex-cell subdivisions (rings = radialSegments + 1). */
  radialSegments: number;
  /** Angular columns around the ring (wraps: column A joins column 0). */
  angularSegments: number;
  /** Outer skirt vertical drop (metres, positive). <= 0 emits no skirt. */
  skirtDrop: number;
}

/** Vertex count for a backdrop ring (base rings + optional skirt bottom ring). */
export function backdropVertexCount(
  radialSegments: number,
  angularSegments: number,
  skirt: boolean,
): number {
  const rings = radialSegments + 1;
  return (rings + (skirt ? 1 : 0)) * angularSegments;
}

/** Index count for a backdrop ring (base quads + optional skirt quads). */
export function backdropIndexCount(
  radialSegments: number,
  angularSegments: number,
  skirt: boolean,
): number {
  const baseTris = radialSegments * angularSegments * 2;
  const skirtTris = skirt ? angularSegments * 2 : 0;
  return (baseTris + skirtTris) * 3;
}

/**
 * Build the backdrop annulus geometry from a HeightSource. Row of `angularSegments`
 * columns per ring (index = ring*A + col); quads wind up-facing to match the
 * chunk mesh (upward normal for a downward suspension ray, though the backdrop
 * has no collider). The optional outer skirt reuses the outermost ring verts as
 * its top and adds one dropped bottom ring, walls facing inward (toward the
 * camera at the centre) so the far edge reads as solid terrain. Pure.
 */
export function buildBackdropRing(p: BackdropRingParams, src: HeightSource): ChunkGeometry {
  const { centerX, centerZ, innerRadius, outerRadius, radialSegments, angularSegments } = p;
  const a = angularSegments;
  const rings = radialSegments + 1;
  const skirt = p.skirtDrop > 0;
  const vertCount = backdropVertexCount(radialSegments, angularSegments, skirt);
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(backdropIndexCount(radialSegments, angularSegments, skirt));
  const rgb: Rgb = [0, 0, 0];
  const nrm: Vec3 = [0, 0, 0];
  // Precompute the per-column unit direction so every ring reuses it.
  const cos = new Float64Array(a);
  const sin = new Float64Array(a);
  for (let ic = 0; ic < a; ic++) {
    const theta = (2 * Math.PI * ic) / a;
    cos[ic] = Math.cos(theta);
    sin[ic] = Math.sin(theta);
  }
  for (let ir = 0; ir < rings; ir++) {
    const r = innerRadius + ((outerRadius - innerRadius) * ir) / radialSegments;
    for (let ic = 0; ic < a; ic++) {
      const x = centerX + r * cos[ic]!;
      const z = centerZ + r * sin[ic]!;
      const v = ir * a + ic;
      writeVert(v, x, z, src.heightAt(x, z), src, positions, colors, normals, rgb, nrm);
    }
  }
  let pi = 0;
  for (let ir = 0; ir < radialSegments; ir++) {
    for (let ic = 0; ic < a; ic++) {
      const ic1 = (ic + 1) % a;
      const va = ir * a + ic;
      const vb = ir * a + ic1;
      const vc = (ir + 1) * a + ic;
      const vd = (ir + 1) * a + ic1;
      // Up-facing winding (a,b,c)+(b,d,c): +col is tangential, +ring is radial.
      indices[pi++] = va;
      indices[pi++] = vb;
      indices[pi++] = vc;
      indices[pi++] = vb;
      indices[pi++] = vd;
      indices[pi++] = vc;
    }
  }
  if (skirt) emitOuterSkirt(p, a, rings, positions, colors, normals, indices, pi);
  return { positions, colors, normals, indices };
}

/** Write one vertex's position/color/normal into the shared arrays. */
function writeVert(
  v: number,
  x: number,
  z: number,
  y: number,
  src: HeightSource,
  positions: Float32Array,
  colors: Float32Array,
  normals: Float32Array,
  rgb: Rgb,
  nrm: Vec3,
): void {
  positions[v * 3] = x;
  positions[v * 3 + 1] = y;
  positions[v * 3 + 2] = z;
  const c = src.colorAt(x, z, rgb);
  colors[v * 3] = c[0];
  colors[v * 3 + 1] = c[1];
  colors[v * 3 + 2] = c[2];
  const n = src.normalAt(x, z, nrm);
  normals[v * 3] = n[0];
  normals[v * 3 + 1] = n[1];
  normals[v * 3 + 2] = n[2];
}

/**
 * Emit the outer skirt: reuse the outermost ring verts as the skirt top, add one
 * dropped bottom ring (top color/normal inherited, y - skirtDrop), and wall
 * quads facing inward toward the ring centre so the far edge reads solid.
 */
function emitOuterSkirt(
  p: BackdropRingParams,
  a: number,
  rings: number,
  positions: Float32Array,
  colors: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  iBase: number,
): void {
  const topBase = (rings - 1) * a; // outermost ring verts
  const bottomBase = rings * a; // freshly added dropped ring
  for (let ic = 0; ic < a; ic++) {
    const t = topBase + ic;
    const b = bottomBase + ic;
    positions[b * 3] = positions[t * 3]!;
    positions[b * 3 + 1] = positions[t * 3 + 1]! - p.skirtDrop;
    positions[b * 3 + 2] = positions[t * 3 + 2]!;
    colors[b * 3] = colors[t * 3]!;
    colors[b * 3 + 1] = colors[t * 3 + 1]!;
    colors[b * 3 + 2] = colors[t * 3 + 2]!;
    normals[b * 3] = normals[t * 3]!;
    normals[b * 3 + 1] = normals[t * 3 + 1]!;
    normals[b * 3 + 2] = normals[t * 3 + 2]!;
  }
  let pi = iBase;
  for (let ic = 0; ic < a; ic++) {
    const ic1 = (ic + 1) % a;
    const t0 = topBase + ic;
    const t1 = topBase + ic1;
    const b0 = bottomBase + ic;
    const b1 = bottomBase + ic1;
    // Inward-facing wall (normal toward centre): (t0,b0,t1)+(t1,b0,b1).
    indices[pi++] = t0;
    indices[pi++] = b0;
    indices[pi++] = t1;
    indices[pi++] = t1;
    indices[pi++] = b0;
    indices[pi++] = b1;
  }
}

/** Snap a world coordinate to a coarse grid so the ring rebuilds infrequently. */
export function snapToStep(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}
