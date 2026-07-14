/**
 * 019 pure chunk geometry builder. Builds a displaced + vertex-colored quad
 * grid for one chunk rectangle from a HeightSource, plus a skirt strip that
 * seals cracks between chunks at different LOD segment tiers. Pure (numbers +
 * typed arrays out) so it runs under jsdom unit tests and is worker-able.
 *
 * Vertex order mirrors PlaneGeometry (row-major: index = iz*(segX+1)+ix, ix
 * steps X, iz steps Z) and the index winding matches Terrain's trimesh
 * ((a,c,b)+(b,c,d), upward-facing for a downward ray) so a chunk's mesh and
 * its collider share identical vertices by construction.
 */

import type { HeightSource, Rgb, Vec3 } from "./heightSource";

export interface ChunkRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Vertex-cell subdivisions along X (x0..x1). */
  segX: number;
  /** Vertex-cell subdivisions along Z (z0..z1). */
  segZ: number;
}

export interface ChunkGeometry {
  positions: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Build one chunk's displaced + vertex-colored quad grid with world-consistent
 * normals (from src.normalAt, NOT per-chunk averaging) so adjacent chunk
 * borders shade identically and the cel banding never splits into a grid.
 * Row-major vertex order (iz*nX+ix); indices wind (a,c,b)+(b,c,d) to match
 * Terrain's trimesh. Pure: numbers + typed arrays only.
 */
export function buildChunk(rect: ChunkRect, src: HeightSource): ChunkGeometry {
  const { x0, z0, x1, z1, segX, segZ } = rect;
  const nX = segX + 1;
  const nZ = segZ + 1;
  const vertCount = nX * nZ;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(segX * segZ * 6);
  const rgb: Rgb = [0, 0, 0];
  const nrm: Vec3 = [0, 0, 0];
  const dx = (x1 - x0) / segX;
  const dz = (z1 - z0) / segZ;
  for (let iz = 0; iz < nZ; iz++) {
    const z = z0 + iz * dz;
    for (let ix = 0; ix < nX; ix++) {
      const x = x0 + ix * dx;
      const v = iz * nX + ix;
      const y = src.heightAt(x, z);
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
  }
  let p = 0;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * nX + ix;
      const b = a + 1;
      const c = a + nX;
      const d = c + 1;
      indices[p++] = a;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = d;
    }
  }
  return { positions, colors, normals, indices };
}

interface EdgePos {
  x: number;
  z: number;
}
type EdgeSampler = (i: number, out: EdgePos) => void;

/**
 * Emit one skirt edge: top verts at terrain height, bottom verts dropped by
 * `drop`, sharing the top color. Quads wind outward. Writes into the shared
 * arrays at vBase/iBase offsets and returns verts written (idx = seg*6).
 * Normals inherit the terrain surface normal at each edge point so the skirt
 * blends with the chunk border; the dropped verts are underground/occluded.
 */
function emitSkirtEdge(
  seg: number,
  sample: EdgeSampler,
  src: HeightSource,
  drop: number,
  positions: Float32Array,
  colors: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  vBase: number,
  iBase: number,
): number {
  const count = seg + 1;
  const topBase = vBase;
  const bottomBase = vBase + count;
  const pos: EdgePos = { x: 0, z: 0 };
  const rgb: Rgb = [0, 0, 0];
  const nrm: Vec3 = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    sample(i, pos);
    const x = pos.x;
    const z = pos.z;
    const y = src.heightAt(x, z);
    const c = src.colorAt(x, z, rgb);
    const n = src.normalAt(x, z, nrm);
    const ti = topBase + i;
    positions[ti * 3] = x;
    positions[ti * 3 + 1] = y;
    positions[ti * 3 + 2] = z;
    colors[ti * 3] = c[0];
    colors[ti * 3 + 1] = c[1];
    colors[ti * 3 + 2] = c[2];
    normals[ti * 3] = n[0];
    normals[ti * 3 + 1] = n[1];
    normals[ti * 3 + 2] = n[2];
    const bi = bottomBase + i;
    positions[bi * 3] = x;
    positions[bi * 3 + 1] = y - drop;
    positions[bi * 3 + 2] = z;
    colors[bi * 3] = c[0];
    colors[bi * 3 + 1] = c[1];
    colors[bi * 3 + 2] = c[2];
    normals[bi * 3] = n[0];
    normals[bi * 3 + 1] = n[1];
    normals[bi * 3 + 2] = n[2];
  }
  let p = iBase;
  for (let i = 0; i < seg; i++) {
    const t0 = topBase + i;
    const t1 = t0 + 1;
    const b0 = bottomBase + i;
    const b1 = b0 + 1;
    indices[p++] = t0;
    indices[p++] = t1;
    indices[p++] = b0;
    indices[p++] = t1;
    indices[p++] = b1;
    indices[p++] = b0;
  }
  return count * 2;
}

/**
 * Build a vertical drop skirt sealing the chunk's 4 edges so adjacent chunks
 * at a different LOD segment tier don't show a gap. Top edge verts sample
 * src.heightAt; bottom verts drop by `drop` (metres, positive) and inherit the
 * top edge color. Returns a standalone geometry (may be merged into the chunk
 * mesh). Pure. Each edge walks so quads face outward: +X/+Z step their near
 * axis, -X/-Z step away (walk x down/out so the cross product points outward).
 */
export function buildSkirt(rect: ChunkRect, src: HeightSource, drop: number): ChunkGeometry {
  const { x0, z0, x1, z1, segX, segZ } = rect;
  const totalVerts = 2 * (segZ + 1 + (segZ + 1) + (segX + 1) + (segX + 1));
  const totalIndices = segZ * 6 + segZ * 6 + segX * 6 + segX * 6;
  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  const spanX = x1 - x0;
  const spanZ = z1 - z0;
  const plusX: EdgeSampler = (i, out) => {
    out.x = x1;
    out.z = z0 + (spanZ * i) / segZ;
  };
  const minusX: EdgeSampler = (i, out) => {
    out.x = x0;
    out.z = z1 - (spanZ * i) / segZ;
  };
  const plusZ: EdgeSampler = (i, out) => {
    out.x = x1 - (spanX * i) / segX;
    out.z = z1;
  };
  const minusZ: EdgeSampler = (i, out) => {
    out.x = x0 + (spanX * i) / segX;
    out.z = z0;
  };

  let vBase = 0;
  let iBase = 0;
  vBase += emitSkirtEdge(segZ, plusX, src, drop, positions, colors, normals, indices, vBase, iBase);
  iBase += segZ * 6;
  vBase += emitSkirtEdge(
    segZ,
    minusX,
    src,
    drop,
    positions,
    colors,
    normals,
    indices,
    vBase,
    iBase,
  );
  iBase += segZ * 6;
  vBase += emitSkirtEdge(segX, plusZ, src, drop, positions, colors, normals, indices, vBase, iBase);
  iBase += segX * 6;
  emitSkirtEdge(segX, minusZ, src, drop, positions, colors, normals, indices, vBase, iBase);
  return { positions, colors, normals, indices };
}

/**
 * Concatenate a base chunk geometry with its skirt into one buffer set (base
 * verts first, then skirt), re-basing the skirt indices past the base vertex
 * count. Pure typed-array op (THREE-free, worker-compatible). The base-first
 * vertex order is load-bearing: {@link buildMorphTargets} maps a merged
 * position array 1:1 through the same order.
 */
export function mergeGeometry(base: ChunkGeometry, skirt: ChunkGeometry): ChunkGeometry {
  const baseVerts = base.positions.length / 3;
  const positions = new Float32Array(base.positions.length + skirt.positions.length);
  positions.set(base.positions, 0);
  positions.set(skirt.positions, base.positions.length);
  const colors = new Float32Array(base.colors.length + skirt.colors.length);
  colors.set(base.colors, 0);
  colors.set(skirt.colors, base.colors.length);
  const normals = new Float32Array(base.normals.length + skirt.normals.length);
  normals.set(base.normals, 0);
  normals.set(skirt.normals, base.normals.length);
  const indices = new Uint32Array(base.indices.length + skirt.indices.length);
  indices.set(base.indices, 0);
  const offset = base.indices.length;
  for (let i = 0; i < skirt.indices.length; i++) {
    indices[offset + i] = skirt.indices[i]! + baseVerts;
  }
  return { positions, colors, normals, indices };
}

/**
 * Bilinearly-interpolated height at (x, z) on a COARSER/finer regular grid of
 * `otherSeg` cells over the same rect bounds — i.e. the height the adjacent LOD
 * tier's tessellation would render there. At a grid-line vertex this equals
 * heightAt exactly; between grid lines it is the flat bilinear the coarse quad
 * shows. Pure (only src.heightAt). Cell index clamped so edges stay in-range.
 */
function otherTierHeight(
  x: number,
  z: number,
  rect: ChunkRect,
  otherSeg: number,
  src: HeightSource,
): number {
  const { x0, z0, x1, z1 } = rect;
  const dxC = (x1 - x0) / otherSeg;
  const dzC = (z1 - z0) / otherSeg;
  let ix = Math.floor((x - x0) / dxC);
  let iz = Math.floor((z - z0) / dzC);
  let fx = (x - x0) / dxC - ix;
  let fz = (z - z0) / dzC - iz;
  if (ix < 0) {
    ix = 0;
    fx = 0;
  } else if (ix >= otherSeg) {
    ix = otherSeg - 1;
    fx = 1;
  }
  if (iz < 0) {
    iz = 0;
    fz = 0;
  } else if (iz >= otherSeg) {
    iz = otherSeg - 1;
    fz = 1;
  }
  const cx0 = x0 + ix * dxC;
  const cz0 = z0 + iz * dzC;
  const h00 = src.heightAt(cx0, cz0);
  const h10 = src.heightAt(cx0 + dxC, cz0);
  const h01 = src.heightAt(cx0, cz0 + dzC);
  const h11 = src.heightAt(cx0 + dxC, cz0 + dzC);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/**
 * Per-vertex geomorph targets for a merged chunk `positions` buffer: the HEIGHT
 * each vertex should slide to under `otherSeg`'s tessellation. Computed as a
 * per-(x,z) height DELTA (otherTierHeight - heightAt) added to the vertex's
 * CURRENT y, so it is correct for base verts, skirt-top verts (delta on the
 * surface), AND skirt-bottom verts (same delta, drop preserved) uniformly. At a
 * shared grid vertex the delta is 0 (no morph). Pure; deterministic from
 * src.heightAt — the collider + heightAt themselves are never touched.
 */
export function buildMorphTargets(
  positions: Float32Array,
  rect: ChunkRect,
  otherSeg: number,
  src: HeightSource,
): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    out[v] = y + (otherTierHeight(x, z, rect, otherSeg, src) - src.heightAt(x, z));
  }
  return out;
}
