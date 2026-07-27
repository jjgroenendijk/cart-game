/**
 * THREE/Rapier-aware chunk geometry builders extracted from
 * TerrainChunkManager. Builds a chunk's visual mesh BufferGeometry (merged
 * base + skirt) and its per-tier trimesh collider from the pure typed-array
 * outputs of `chunkBuilder.ts` (which stays THREE-free + worker-able).
 *
 * Stateless (deps passed per call); the manager captures `src`/`chunkSize`/
 * `quality`/`skirtDrop`/`physics` and delegates here.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { HeightSource } from "./heightSource";
import { buildChunk, buildSkirt, mergeGeometry, type ChunkRect } from "./chunkBuilder";
import { chunkBounds } from "./streamGrid";
import { segmentTier, type TerrainLodTier } from "./terrainLod";
import type { QualityTier } from "../core/quality";
import type { Pt } from "../kart/kartLod";

/** Tier rect for chunk (gx,gz) at `quality`/`tier` segment resolution. Pure. */
function buildSegmentRect(
  gx: number,
  gz: number,
  tier: TerrainLodTier,
  chunkSize: number,
  quality: QualityTier,
): ChunkRect {
  const b = chunkBounds(gx, gz, chunkSize);
  const seg = segmentTier(quality, tier);
  return { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, segX: seg, segZ: seg };
}

export interface ChunkMeshBuild {
  rect: ChunkRect;
  center: Pt;
  geometry: THREE.BufferGeometry;
}

/**
 * Build a chunk's visual mesh geometry (merged base + skirt) for `tier`.
 * The collider is separate (createTierCollider) so a tier change can swap
 * mesh geometry without touching Rapier. Returns the tier rect + chunk
 * center (center is tier-independent: rect x0/z0 don't depend on seg count).
 */
export function buildChunkMeshGeometry(
  gx: number,
  gz: number,
  tier: TerrainLodTier,
  src: HeightSource,
  chunkSize: number,
  quality: QualityTier,
  skirtDrop: number,
): ChunkMeshBuild {
  const rect = buildSegmentRect(gx, gz, tier, chunkSize, quality);
  const chunk = buildChunk(rect, src);
  const skirt = buildSkirt(rect, src, skirtDrop);
  const merged = mergeGeometry(chunk, skirt);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(merged.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(merged.colors, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(merged.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(merged.indices, 1));
  // Normals come straight from the HeightSource (world-consistent central
  // differences), NOT computeVertexNormals: per-chunk averaging over
  // duplicated border verts would disagree with the neighbour chunk and the
  // cel bands would split the terrain into a visible grid.
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const center: Pt = { x: cx, y: src.heightAt(cx, cz), z: cz };
  return { rect, center, geometry };
}

/**
 * Build a per-tier trimesh collider for the driving surface (base chunk
 * verts only, no skirt) attached to `body`. Created disabled when `enabled`
 * is false so a tier can be cached without being queryable until toggled.
 * Friction + restitution match the original single-collider build.
 */
export function createTierCollider(
  gx: number,
  gz: number,
  tier: TerrainLodTier,
  body: RAPIER.RigidBody,
  enabled: boolean,
  src: HeightSource,
  chunkSize: number,
  quality: QualityTier,
  physics: PhysicsWorld,
): RAPIER.Collider {
  const rect = buildSegmentRect(gx, gz, tier, chunkSize, quality);
  const chunk = buildChunk(rect, src);
  const desc = RAPIER.ColliderDesc.trimesh(chunk.positions, chunk.indices)
    .setFriction(1.0)
    .setRestitution(0)
    .setEnabled(enabled);
  return physics.world.createCollider(desc, body);
}
