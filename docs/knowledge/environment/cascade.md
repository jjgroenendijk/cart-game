---
type: DataFlow
title: Environment Cascade
description: "Load-bearing update order: DynamicSky, biome bias, weather, channels, lightning."
tags: [environment, cascade, biome]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

```mermaid
flowchart LR
  sky[DynamicSky.update] --> bias[applyBiomeSkyFogBias 0.2]
  bias --> dir[director resolve preset+level]
  dir --> chan[channels dim/wind/wetness]
  chan --> lightning[lightning flashes]
  lightning --> wx[weather.update patchFog]
```

# Description

DynamicSky.update writes dayCycleState first. applyBiomeSkyFogBias lerps
fog/sky toward biome.skyFogBias by BIOME_TINT_FACTOR=0.2 (no-op for
temperate). Director resolves preset and level; setLevel(k in [0,1]) scales
field opacity. Channels compute dimFactor, windFactor, wetness lerps.
Lightning drives additive sun/ambient boosts (storm only). weather.update
patches fog LAST. waterColor -> CelWater uTint (white = identity).
Temperate = undefined = parity; wildlife [] opts out.

# Construction

Environment constructs each visual subsystem (clouds, water, dynamicSky,
sunDisc, weather, wildlife) exactly once, then adds all six plus dressing
(7 children) to `this.group`. No duplicate construction; first-pass objects
are the live ones so disposal stays single-owner.

# Cross-References

- [DynamicSky](/environment/dynamic-sky.md)
- [Weather](/environment/weather.md)
- [Water](/environment/water.md)
- [Biomes](/terrain/biomes.md)
- [CelMaterial](/materials/cel-material.md)
