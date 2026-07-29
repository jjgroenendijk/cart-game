---
type: Subsystem
title: Clouds
description: World-stationary recycled cloud puffs with day-cycle tint and weather-driven drift
tags: [environment, sky, clouds]
timestamp: 2026-07-29T19:10:00Z
---

# Schema

`Clouds` renders one `InstancedMesh` of squashed-icosahedron puffs on layer 0,
driven by one fogged `CelMaterial`. `clusterLayout` places each cloud as K
jittered puffs around a centre for a painted-blob silhouette. `cloudTintFor`
keeps them white by day and warms/darkens them toward the live horizon tint at
dawn, dusk, and night.

Per-frame update recycles every puff's XZ around the moving focus
(`recycleAxis`, pure helper), so the near field stays world-stationary (clouds
gain correct driving parallax) instead of rigidly translating with the kart.
Wind drifts puffs +X, modulated by the weather wind channel.

There is no camera-locked or continuous cloud geometry at the horizon. Distant
puffs thin and fog naturally; the terrain backdrop, distance fog, and sky
gradient own the horizon silhouette. No outlines (removed game-wide for the
realism art direction). No shadows.

The mesh sets `frustumCulled = false`: an `InstancedMesh` bounding sphere is
computed once (lazily, at the first cull test) and never re-derived, while
the recycle recentres every instance around the moving focus — a travelled
focus would leave a stale sphere that wrongly culls the whole field (all
clouds blink out when the camera looks away from where the sphere was
baked). The field surrounds every camera by construction, so the cull test
can never win.

The cloud domain scales to the sky, not the near player. A puff recycles
(snaps to the far side) only when it drifts past `focus ± (worldHalfExtent +
20)`. `Environment` grows that domain to `max(circuit.worldSize/2, 340)` so the
boundary sits in (or past) the fog-far horizon (~360) instead of in clear view
— clouds are always present in the distance and never pop in as they recycle.
The default `count` scales with domain AREA (`round(24 · (half/100)²)`, capped
at 400) so a larger sky keeps the same puff spacing rather than thinning out;
`worldHalfExtent == 100` reproduces the pre-scale count of 24 (unit-test
parity).

# API

- `Clouds(opts?: CloudsOptions)` — constructor: `count` (default area-scaled
  from `worldHalfExtent`), `puffsPerCloud` (6), `density` (multiplier),
  `altitude`/`cloudHeight` (60), `worldHalfExtent` (100; `Environment` passes
  `max(worldSize/2, 340)`), `driftSpeed` (2 m/s), `seed` (1337), `color` (sRGB
  hex).
- `update(dt, focusX, focusZ)` — advances puff drift, recentres the recycled
  field around the focus, and re-derives its tint from `dayCycleState.phase`
  and `.skyHorizon` via `cloudTintFor`.
- `setWindMultiplier(m)` — weather channel writes this once/frame (default 1
  = parity). Scales the base drift speed.
- `dispose()` — frees geometry and material; idempotent.

`recycleAxis(base, motion, focus, half)` is a pure export: `world = focus +
mod(base + motion - focus + half, 2*half) - half`. Mirrors the snow
vertex-shader XZ wrap so the cloud field stays world-stationary.

`clusterLayout` is a pure, deterministic `Matrix4[]` builder in
`cloudCluster.ts` (jsdom-safe).

# Cross-References

- [DynamicSky](/environment/dynamic-sky.md)
- [Environment Cascade](/environment/cascade.md)
- [Weather](/environment/weather.md)
