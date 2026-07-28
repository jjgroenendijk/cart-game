---
type: Reference
title: Rapier
description: "Rapier 0.19 WASM physics: rigid bodies, trimesh collider, raycasts for kart."
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
| Sensor colliders | `setSensor(true)` overlap enter/exit      |
| Collision types  | `ActiveCollisionTypes` (re-exported)      |

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

# Sensor / intersection events

EventQueue is autoDrain: `drainCollisionEvents` MUST run right after each
`step()` (same contract as `drainContactForceEvents`), else events are lost
before the next step.

A trigger collider = `setSensor(true)` +
`setActiveEvents(ActiveEvents.COLLISION_EVENTS)`. The drain yields
`(handle1, handle2, started)`: `started=true` -> overlap begin,
`started=false` -> overlap end. Sensors produce no contact forces.

`PhysicsWorld` re-exports `ActiveEvents` + `ActiveCollisionTypes`, so callers
flag colliders without importing the rapier binding.

`PhysicsWorld` owns a collider->kind registry (`setColliderKind` /
`colliderKind` / `clearColliderKinds`) so event consumers resolve handle
pairs to semantic kinds (e.g. "water", "item"). Call `clearColliderKinds()`
on field rebuild. Mirrors the colliderHandle->kartIndex map in
`src/audio/gameAudio.ts`.

```ts
const cd = RAPIER.ColliderDesc.ball(r)
  .setSensor(true)
  .setActiveEvents(ActiveEvents.COLLISION_EVENTS);
physics.drainCollisionEvents((h1, h2, started) => {
  const kind = physics.colliderKind(h1) ?? physics.colliderKind(h2);
  // route by started/kind: "water", "item", ...
});
```

# Citations

- [KartController](/kart/controller.md)
- [Height Pipeline](/terrain/height-pipeline.md)
- [Game](/core/game.md)
- [AudioManager](/audio/audio-manager.md)
