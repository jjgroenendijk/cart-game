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

# Citations

- [KartController](/kart/controller.md)
- [PlayerView](/core/player-view.md)
- [Quality](/core/quality.md)
