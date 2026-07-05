---
type: Subsystem
title: SunDisc
description: Additive sun-disc overlay rendered at the sun's world-space position
tags: [environment, sky, sun]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

`SunDisc` renders a bright icosahedron disc at the computed sun direction.
Fades by `1 - nightFactor` (visible by day, gone at night — the inverse of
the moon's nightFactor fade). Additive blending + `depthWrite:false` produce
a soft glow rather than a solid occluder.

Owned by Environment (not DynamicSky). Conceptual mirror of the moon disc
but day-gated.

# API

- `SunDisc(opts?: SunDiscOptions)` — constructor takes `radius` (default 40,
  matches moon) and `color` (default `0xffe8b0`, dayCycle day sun).
- `update()` — positions the disc at `dayCycleState.sunDirWorld * SUN_SHELL`
  (1500 world units), fades opacity by `1 - nightFactor`, hides when
  `opacity < 0.05`.
- `dispose()` — frees geometry and material; idempotent.

Renders on layer 0, `renderOrder = -1`, so it sits behind terrain/kart
geometry.

# Cross-References

- [DynamicSky](/environment/dynamic-sky.md)
- [Environment Cascade](/environment/cascade.md)
