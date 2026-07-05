---
type: Subsystem
title: DynamicSky
description: Day/night cycle rendering sun arc, moon, stars, and atmospheric fog on render layer 2.
tags: [environment, sky, day-night]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Owns the day/night cycle: sun arc, moon disc, star field, and atmospheric
fog. Renders on [layer 2](/conventions/render-layers.md).

Writes to dayCycleState singleton consumed by lightUniforms and weather fog.

# API

`setElapsed`, `setDayLength`, `setFrozen` allow reconfiguration without
rebuild.

DynamicSky.update runs FIRST in the [environment cascade](/environment/cascade.md)
before biome bias, weather, and fog patching.

# Examples

```ts
sky.setElapsed(0.3); // jump to 30% of day
sky.setDayLength(120); // 120 real seconds per cycle
sky.setFrozen(true); // pause cycle for menu
```

# Cross-References

- [Environment Cascade](/environment/cascade.md)
- [Weather](/environment/weather.md)
- `src/environment/Clouds.ts`
- `src/environment/SunDisc.ts`
