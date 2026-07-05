---
type: Subsystem
title: DynamicSky
description: Day/night cycle rendering sun arc, moon, star field, and atmospheric fog
tags: [environment, sky, day-night]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Owns the day/night cycle: sun arc, star field (`THREE.Points`), moon disc
(`THREE.Mesh`), and atmospheric fog. DynamicSky's visible objects (stars,
moon) render on layer 0 (`SKY_LAYER = 0`). The gradient sky dome/mesh is
owned by the Renderer's SkyPosterizePass, not DynamicSky.

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
