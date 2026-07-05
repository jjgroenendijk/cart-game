---
type: Subsystem
title: Clouds
description: Drifting layer-0 cloud puffs with weather-wind-modulated drift and day-cycle tint
tags: [environment, sky, clouds]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`Clouds` renders a single `InstancedMesh` of squashed-icosahedron puffs on
layer 0. Puffs are placed once (deterministic seed) via `clusterLayout`:
each cloud is K jittered puffs around a centre producing a painted-blob
silhouette.

Per-frame update recycles every puff's XZ around the moving focus
(`recycleAxis`, pure helper), so the field stays world-stationary (clouds
gain correct driving parallax) instead of rigidly translating with the
kart. Wind drifts puffs +X, modulated by the weather wind channel.

No outline (inverted-hull shader has no instance-matrix path; soft cel
blobs are the accepted fallback). No shadows.

# API

- `Clouds(opts?: CloudsOptions)` — constructor: `count` (24), `puffsPerCloud`
  (6), `density` (multiplier), `altitude`/`cloudHeight` (60), `worldHalfExtent`
  (100), `driftSpeed` (2 m/s), `seed` (1337), `color` (sRGB hex).
- `update(dt, focusX, focusZ)` — advances drift + re-derives cloud tint
  from `dayCycleState.phase` and `.skyHorizon` via `cloudTintFor`.
- `setWindMultiplier(m)` — weather channel writes this once/frame (default 1
  = parity). Scales the base drift speed.
- `dispose()` — frees geometry and material; idempotent.

`recycleAxis(base, motion, focus, half)` is a pure export: `world = focus +
mod(base + motion - focus + half, 2*half) - half`. Mirrors the snow
vertex-shader XZ wrap so the cloud field stays world-stationary.

# Cross-References

- [DynamicSky](/environment/dynamic-sky.md)
- [Environment Cascade](/environment/cascade.md)
- [Weather](/environment/weather.md)
