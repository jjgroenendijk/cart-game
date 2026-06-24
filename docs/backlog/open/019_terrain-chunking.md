# 019 Terrain chunking

Status: open (concept — to be refined)

## Context

Split from 011 (was 011's "Terrain LOD" goal). 011 measures first + lands the
cheap wins (big-prop merge, quality tier, kart LOD, instrumentation); terrain
chunking is the large, riskier piece and is premature without 011's baseline
numbers. Today terrain is ONE displaced PlaneGeometry mesh at 200x200 segments
(~40k verts) plus a matching Rapier trimesh collider, both from the same
displaced vertex buffer (`Terrain.ts:102-162`). No chunking, no LOD, no skirt
stitching. Fog ends at 360 m (`Renderer.ts:99`) and the world is 200 m, so the
single mesh is usually in view — but it pays full vertex cost at every distance
and the trimesh collider is one large accel structure.

Kept separate because chunking touches the visual mesh AND the collider AND the
shared `heightAt` source, and is the single biggest scope item in the original
011 concept (`011` Needs refinement: "Is this one item or should terrain-
chunking split out (it's large)?").

## Goal

- Chunked terrain mesh with distance-based LOD (near high-seg, far low-seg) and
  skirt stitching between adjacent LOD bands (no cracks/gaps).
- Chunked (or partitioned) trimesh collider that stays identical to the visual
  vertices by construction (`Terrain.ts:127-162` invariant), or a documented
  alternative with ray-hit parity (the heightfield-trimesh precedent,
  `Terrain.ts:41-47`).
- Optional: streaming / late-load of distant chunks if the budget demands it.

## Non-goals

- Changing `heightAt` semantics (one shared fn stays the source of truth,
  `src/AGENTS.md`).
- GPU tessellation / clipmap (CPU chunk build only in v1).
- Editing tools / in-game terrain modification.

## Dependencies

011 (measurement baseline + perf budget; chunk only if terrain is the measured
hotspot). 003 (terrain mesh + trimesh collider). 001 (cel material + post
Sobel outline on layer 1 unchanged). No gameplay deps.

## Needs refinement

- LOD strategy: chunked quadtree with skirt stitching (real answer, big), or a
  single mesh with shader detail drop (cheaper, no crack risk)?
- Chunk size + LOD band distances vs 011's measured frame budget.
- Collider story: chunk the trimesh too (broadphase cost?), keep one trimesh,
  or revisit Rapier heightfield now that rays are needed only per-chunk?
- Skirt stitching approach (geometry skirts vs stencil/depth fill).
- Build cost: chunk build at load (current ctor path, `Terrain.ts:58-72`) vs
  worker; keep load-time budget sane.
- Recompute vertex colors (`Terrain.ts:107-118`) per chunk from `colorAt`.
- Does chunking interact with the PostOutline layer-1 normal/depth pre-pass
  (`postOutline.ts:170-191`)? It should not (still layer 1), but verify edges.
