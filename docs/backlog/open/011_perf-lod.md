# 011 LOD + performance budget

Status: open (concept — to be refined)

## Context

Cross-cutting perf item. 004 already raises shadow-map + draw-call concerns:
instanced decor set to receive-only/no-cast to protect the shadow map
(`004:177-179`), and `InstancedMesh` batching for props was deferred from 001
(`001:131`) into 004. No LOD anywhere; all meshes (terrain 200x200 ~1m segs,
thousands of instances, rival karts from 007) render at full detail at every
distance. No perf budget or guardrails defined; risk grows with 007 (AI
field) and 010 (particles/wildlife).

Kept separate because perf is orthogonal to any single feature — it budgets
all of them.

## Goal

- LOD groups: distance-based detail reduction for terrain, props (004
  instanced decor), karts (P2 + AI rivals from 007/008). Geo + shadow LOD.
- Draw-call + shadow-budget targets (define numbers at refinement).
- Frame-time guardrail: instrumentation + a budget gate (e.g. dynamic shadow
  distance / instance cull) to hold target FPS on mid hardware.
- Build-time / dev overlay: stats (draw calls, tris, FPS, physics step ms).

## Non-goals

- GPU instancing rewrite beyond what 004 already ships (only add LOD to it)
- Mesh simplification pipeline/tooling (use authored LOD levels or drop
  detail by disabling features — keep manual)
- Networked perf / server budget (local game)
- Mobile-tier target (define a desktop floor; mobile = future)

## Dependencies

001 (materials + render layers). 003 (terrain mesh). 004 (prop instances,
water, clouds). 007 (rival karts to LOD). 010 (particles/wildlife add load).
No new gameplay deps; consumes finished meshes.

## Needs refinement

- Target FPS + hardware floor (60 FPS on what GPU class?)
- LOD strategy for InstancedMesh (three.js per-instance LOD is limited —
  likely swap whole InstancedMesh by distance band, or merge into fewer sets)
- Terrain LOD: chunked with skirt stitching, or single mesh with shader
  detail drop? (chunking is the real answer but big — scope call needed)
- Shadow LOD: cascade vs single map + distance cull
- Is this one item or should terrain-chunking split out (it's large)?
- Dev overlay lives where (extend HUD? separate debug HUD?)
