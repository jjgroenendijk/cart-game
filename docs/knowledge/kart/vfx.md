---
type: Subsystem
title: Kart VFX
description: GPU ring-buffer particles with smooth fades for kart action effects.
tags: [kart, vfx, particles, gpu]
timestamp: 2026-07-29T00:00:00Z
---

# Schema

GPU particle effects via ring buffer on layer 0.

Emission rules:

- Dust above 8 m/s on grounded rear wheels (tinted via terrain colorAt)
- Drift smoke while isDrifting + grounded
- Splash while inWater
- Poof burst at respawn

## Architecture

kartVfx.ts is the pure emitter + ring-buffer core (no THREE, jsdom-tested).
KartVfxLayer.ts is the GL owner: single THREE.Points on layer 0.
Vertex shader ages, moves, and grows particles by uTime. The fragment shader
uses a continuous smoothstep age curve for alpha; emitter
`quantizedFadeSteps` compatibility values stay zero and do not branch the
shader.
Reads uAmbient from lightUniforms so particles darken at night.

## Quality Tiers

| Tier   | Particle Budget |
| ------ | --------------- |
| Low    | 512             |
| Medium | 1536            |
| High   | 3072            |

Filename split (KartVfxLayer vs KartVfx) is macOS case-insensitive workaround.

# Citations

- [SkidMarks](/kart/skid-marks.md)
- [KartController](/kart/controller.md)
- [Quality](/core/quality.md)
