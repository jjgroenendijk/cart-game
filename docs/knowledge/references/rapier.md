---
type: Reference
title: Rapier
description: Rapier 0.19 WASM physics: rigid bodies, trimesh collider, raycasts for kart.
tags: [reference, rapier, physics]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`@dimforge/rapier3d-compat` 0.19 provides WASM-based physics.

| Feature          | Usage                                     |
| ---------------- | ----------------------------------------- |
| Rigid bodies     | Karts, big props (dynamic + kinematic)    |
| Trimesh collider | Terrain (same verts as visual mesh)       |
| Raycasts         | Kart suspension to terrain                |
| `initRapier()`   | WASM bootstrap in `main.ts` before `Game` |

`PhysicsWorld` wrapper manages world, stepping, and rigid body lifecycle.

**Fixed step**: Physics at [1/60 interval](/conventions/fixed-step.md),
driven by the accumulator (`MAX_STEPS=5`).

# Examples

```ts
// main.ts — init order
await initRapier(); // bootstrap WASM
const game = new Game(canvas); // Game creates PhysicsWorld internally
```

```ts
// Kart suspension raycast sketch
const ray = new RAPIER.Ray(kartPos, { x: 0, y: -1, z: 0 });
const hit = world.castRay(ray, maxDist, true);
```

# Citations

- [KartController](/kart/controller.md)
- [Height Pipeline](/terrain/height-pipeline.md)
- [Game](/core/game.md)
