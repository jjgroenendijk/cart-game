---
type: Subsystem
title: Kart Mesh
description: Procedural kart mesh, visual sync from physics, cameras, LOD, grid positioning.
tags: [kart, mesh, camera, lod]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Kart (Kart.ts) owns procedural kart mesh and visual sync from physics bodies.

ChaseCamera provides third-person chase view. MenuCamera handles menu scene.
KartGrid positions karts for race start.

kartLod handles distance LOD (full/reduced/minimal) with hysteresis;
Renderer applies per renderViews.

kartVariants provides visual variants (color, body style).

## Outline rendering

All kart parts use the inverted-hull outline technique from `materials/outline.ts`.
`addOutline(mesh, thickness)` attaches a BackSide child mesh that expands along
view-space normals, producing a constant-screen-space toon rim.

Two thickness tiers in NDC units:

| Constant         | Value (NDC) | Applied to                    |
| ---------------- | ----------- | ----------------------------- |
| `BODY_OUTLINE`   | 0.005       | Chassis, nose                 |
| `DETAIL_OUTLINE` | 0.004       | Seat, driver, spoiler, wheels |

Wing struts have `userData.kartDetail = true` for LOD but no outline of their own.
Outline meshes use `renderOrder = -1` so the parent mesh overdraws the interior,
avoiding z-fighting on coplanar parts.

## Disposal

`Kart.dispose()` frees GL resources: detaches every inverted-hull outline
(disposes its unique InvertedHullMaterial) and disposes the unique
geometries + materials across the chassis and wheels. The Rapier body is
NOT owned here — FieldBuilder removes it from the world and then calls
`kart.dispose()` for every human + rival on field teardown.

# Citations

- [KartController](/kart/controller.md)
- [PlayerView](/core/player-view.md)
- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel.md)
