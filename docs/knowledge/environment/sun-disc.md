---
type: Subsystem
title: SunDisc
description: Additive sun-disc overlay rendered at the sun's world-space position
tags: [environment, sky, sun]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`SunDisc` renders a bright icosahedron CORE plus a larger dimmer additive
CORONA halo at the computed sun direction. Both fade by `1 - nightFactor`
(visible by day, gone at night — the inverse of the moon's nightFactor
fade). Additive blending + `depthWrite:false` produce a soft glow rather
than a solid occluder.

074 commit 5 added the corona so the bloom pass (UnrealBloomPass) reads a
bright core with a soft gradient around it instead of a single hard-edged
flat dot. The core is the pre-074 disc HDR-boosted by `SUN_CORE_BOOST` (4)
so its luminance (~3.6) clears the ~2.0 bloom threshold that excludes all
cel scenery (max ~1.8 linear); the corona stays at the base sun tint and
is `radius * CORONA_SCALE` (2.0) at `CORONA_OPACITY` (0.12) of the core
opacity. Both share one position + color.

Owned by Environment (not DynamicSky). Conceptual mirror of the moon disc
but day-gated.

# API

- `SunDisc(opts?: SunDiscOptions)` — constructor takes `radius` (default 40,
  matches moon) and `color` (default `0xffe8b0`, dayCycle day sun); both
  apply to core + corona.
- `update()` — positions core + corona at
  `dayCycleState.sunDirWorld * SUN_SHELL` (1500 world units); core opacity
  `= 1 - nightFactor` (unclamped); corona opacity
  `= (1 - nightFactor) * CORONA_OPACITY`; both hidden when the core opacity
  `< 0.05`.
- `dispose()` — frees both geometries + both materials; idempotent.

`group.children = [core, corona]` (core at index 0 — load-bearing;
Environment reaches it there). Both render on layer 0; core `renderOrder`
`-1`, corona `-2` so the corona draws first and the bright core composites
on top.

# Cross-References

- [DynamicSky](/environment/dynamic-sky.md)
- [Environment Cascade](/environment/cascade.md)
