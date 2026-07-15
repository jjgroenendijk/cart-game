---
type: Subsystem
title: Clouds
description: Near recycled puffs plus a parallax-free far horizon band, day-cycle tinted
tags: [environment, sky, clouds]
timestamp: 2026-07-16T00:00:00Z
---

# Schema

`Clouds` renders two `InstancedMesh`es of squashed-icosahedron puffs on layer
0, each driven by its OWN `CelMaterial` (both `fog:true`) so their tints move
independently:

- Near field (`children[0]`) — placed once via `clusterLayout`: each cloud is K
  jittered puffs around a centre producing a painted-blob silhouette. Tinted by
  `cloudTintFor` (white by day; warms/darkens toward the horizon at dawn/dusk/
  night).
- Far band (`children[1]`) — placed once via `farBandLayout`: a ring of large
  soft puffs around the horizon (see Far band below). Present by default; drop
  with `farBand:false`.

Per-frame update recycles every NEAR puff's XZ around the moving focus
(`recycleAxis`, pure helper), so the near field stays world-stationary (clouds
gain correct driving parallax) instead of rigidly translating with the kart.
Wind drifts puffs +X, modulated by the weather wind channel.

No outline (inverted-hull shader has no instance-matrix path; soft cel
blobs are the accepted fallback). No shadows.

## Far band (parallax-free horizon layer)

The recycled near puffs are inherently prone to recycle/pop artifacts at the
far horizon. Not the wrap itself — that happens at `focus ± (worldHalfExtent +
20)` ≥ 360, fully fogged — but the fog-out that precedes it: a near puff fades
to fog colour across the ~250-360 m band as it drifts toward the wrap, and that
fade reads as distant clouds winking in and out as you drive/turn. The far band
exists to MASK that: it is a ring of large puffs the camera drags along by XZ
each frame (`mesh.position.set(focusX, 0, focusZ)` in `update`), so it holds a
fixed camera-relative position — zero parallax, no instance ever wraps, it can
neither recycle nor pop. To actually stand in front of the near field's fade
it must sit nearer than the fade zone and be dense enough to read there:
`farBandRadius` 240 m (inside day fog-far 360 / night 280, just ahead of the
~250 m fade onset), a CONTINUOUS ring of `farBandClusters` (28) × `farBandPuffs`
(5) overlapping blobs (`scaleRange` [9,13], 10 m vertical spread) — a soft
horizon bank, not the thin gappy pre-tune ring (260 m / 16×4) that sat too far
out and too sparse to mask anything. Kept a horizon band (not a full sky
ceiling) so the mostly-open painterly sky is preserved.

The band owns a SEPARATE `CelMaterial` (`fog:true`, `USE_FOG`) so it still hazes
into the fogged horizon and never silhouettes — consistent with the sky+fog
hue-sharing invariant. Own material because the band hangs LOW on the horizon
(radius 240, alt `cloudHeight·1.05` ≈ 63, ~8-20° elevation), so a pure-white
bank there reads as a solid ridge against a warm biome horizon (desert `fogTint`
0xe8cf9a) — an out-of-place "white mountain". `update` therefore tints it by
`farBandTintFor` (blend `FAR_BAND_TINT_BLEND`: day 0.6, dawn/dusk 0.72, night
0.5 — much harder than the near puffs' `CLOUD_TINT_BLEND`, and shifting even by
DAY) so it dissolves into the horizon as haze while the high near puffs stay
white overhead. `frustumCulled = false` (like the near field): the ring
surrounds every camera, so the cull test can never usefully win. Y is not locked
(band altitude is baked in the matrices; vertical parallax at this range is
imperceptible).

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
  hex). Far band: `farBand` (true), `farBandRadius` (240), `farBandClusters`
  (28), `farBandPuffs` (5), `farBandAltitude` (`cloudHeight·1.05`). The band
  seed is `seed ^ 0x5eed` so it varies independently of the near field.
- `update(dt, focusX, focusZ)` — advances near-puff drift, camera-locks the far
  band to `(focusX, 0, focusZ)`, and re-derives both cloud tints from
  `dayCycleState.phase` and `.skyHorizon`: near via `cloudTintFor`, far via
  `farBandTintFor` (harder horizon blend).
- `setWindMultiplier(m)` — weather channel writes this once/frame (default 1
  = parity). Scales the base drift speed.
- `dispose()` — frees geometry and both materials; idempotent.

`recycleAxis(base, motion, focus, half)` is a pure export: `world = focus +
mod(base + motion - focus + half, 2*half) - half`. Mirrors the snow
vertex-shader XZ wrap so the cloud field stays world-stationary.

`clusterLayout` (near field) and `farBandLayout` (far ring) are pure,
deterministic `Matrix4[]` builders in `cloudCluster.ts` (jsdom-safe).

# Cross-References

- [DynamicSky](/environment/dynamic-sky.md)
- [Environment Cascade](/environment/cascade.md)
- [Weather](/environment/weather.md)
