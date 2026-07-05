---
type: Subsystem
title: Height Pipeline
description: Shared heightAt(x,z) feeding terrain mesh, vertex colors, Rapier collision geometry.
tags: [terrain, heightmap, rendering]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

One shared `heightAt(x,z)` function uses SplineFieldCache bilinear lookup plus
SimplexNoise2D hill fields. This single function feeds:

- Visual terrain mesh (displaced vertices)
- Terrain vertex colors (road/grass/rock/sand)
- Rapier trimesh collider

Terrain collider is a Rapier trimesh built from the same displaced mesh
buffer — mesh vertices and collider vertices are identical by construction.

## Vertex Colors

CelMaterial uses `vertexColors: true` for road/grass/rock/sand on
[render layer 1](/conventions/render-layers.md).

Vertex color attribute values are sRGB→LINEAR to match ColorManagement.

# Citations

- [Chunk Streaming](/terrain/chunk-streaming.md)
- [HeightSource](/terrain/chunk-streaming.md)
- [CelMaterial](/materials/cel-material.md)
