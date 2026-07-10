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
KartGrid positions karts for race start. Columns spread laterally across
[-1, 1] of the `lateral` half-offset mapped to the column index (2-column
straddle is the default); rows step backwards by `longitudinalGap`.

kartLod handles distance LOD: full < 25 m, reduced 25-70 m, minimal >
70 m (hysteresis 5 m). Renderer applies per renderViews.

kartVariants provides 6 archetypes with full `KartTuning` physics
overrides, `StatBars`, and `KartSilhouette`. See
[Kart Variants](/kart/kart-variants.md).

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

## Menu Camera

`src/kart/MenuCamera.ts` is a cinematic high-orbit camera for the title
screen. It slowly yaws around a fixed scenic track point at a large
radius + altitude so the world sweeps under a high cam. An all-layers
`PerspectiveCamera` — it sees the solid (0), terrain (1), and sky (2)
layers. The target is sampled once (by Game, from
`SplineTrack.getPoint` at construction) and passed in; MenuCamera never
touches the spline per frame. A separate camera object from
ChaseCamera keeps `ChaseCamera.initialized` false until the first
racing frame, so it snaps to the kart on race start.

# Citations

- [KartController](/kart/controller.md)
- [PlayerView](/core/player-view.md)
- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
