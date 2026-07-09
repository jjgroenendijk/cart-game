# 071 World streaming architecture

Status: open (concept - to be refined)

## Context

Terrain already streams chunks around active cameras, and dressing streams
per-chunk prop fields. Water was still a single plane until 080 made it match
the baked terrain bounds; that fixes the visible cutoff for generated circuits
but is not the long-term model for larger or effectively endless worlds.

The next architecture should answer one shared question consistently: which
world cells should exist for the current player/camera set? It should not make
one broad manager own every mesh, collider, shader, or particle system. Terrain,
props, water, weather, wildlife, and VFX have different lifecycles and budgets.

## Goal

Introduce a small shared streaming core that computes desired chunk keys from
one or more observers, then lets each subsystem own how its chunks are created,
updated, rendered, and disposed.

## Proposed shape

- `WorldStreamer` or `ChunkStreamer<T>` owns chunk-key selection only:
  observer positions, stream radius, cull radius, hysteresis, activation budget,
  active/pending/disposed state, and optional debug metrics.
- Subsystem clients provide lifecycle hooks:
  `create(key, tier)`, `update(chunk, tier)`, and `dispose(chunk)`.
- `TerrainChunkManager` and `DressingChunkManager` migrate onto the shared
  selector once water exposes the missing cases.
- `WaterChunkManager` becomes the first new client:
  near tiles use depth-aware shore foam, while out-of-field or far tiles use a
  simpler fogged/facing fallback.
- Distance tiers are shared as policy but interpreted per subsystem:
  near = full detail, mid = reduced work, far = silhouettes/fog-only where
  valid.

## Needs refinement

- API boundary: decide whether the shared core is a pure planner returning
  desired keys, or a small stateful manager that also owns activation queues.
- Observer model: support 1P, split-screen 2P, menu camera focus, and future
  replay/spectator cameras without each subsystem duplicating desired-key math.
- Budgeting: per-system activation limits are likely needed; terrain collider
  chunks cost more than water tiles, and props have sampling/merge cost.
- Tiers: define shared distance bands, but keep per-subsystem interpretation
  local so water transparency, terrain colliders, and prop meshes do not leak
  into a generic object type.
- Water data: choose how depth/foam tiles sample height outside the baked field:
  per-tile mini heightmaps, shared terrain height source sampling, or far-water
  fallback with no foam.
- Disposal guarantees: make ownership explicit so Rapier bodies, geometries,
  materials, textures, and instanced buffers are released by the subsystem that
  created them.
- Debugging: add an optional overlay/StatsHud readout for active chunks,
  pending activations, culled chunks, and per-subsystem counts.
- Validation: pure unit tests for key selection/hysteresis, subsystem tests for
  create/dispose calls, and browser visual checks for water/terrain tile seams.

## Non-goals

- Do not create a universal world-object manager that owns all scene objects.
- Do not move physics, material, shader, or particle lifecycle into the shared
  streaming core.
- Do not solve renderer pass count or split-screen composer cost here; that is
  tracked by 022.
- Do not replace terrain LOD policy wholesale; reuse existing terrain tiers
  where possible.

## First implementation slice

1. Add a pure chunk-selection module with tests for observer union,
   stream/cull hysteresis, and activation ordering.
2. Implement `WaterChunkManager` against that module, keeping current water
   material behavior for near tiles.
3. Migrate dressing and terrain selection only after water proves the shared
   selector covers the missing cases.

## Depends on

080 (water bound fix) for the immediate cutoff repair. Coordinates with 011
(LOD), 022 (render-pass perf), 023 (streaming terrain), and 062
(depth-aware water).
