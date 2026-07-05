---
type: System
title: Light Uniforms
description: Shared sun/ambient uniform singleton updated once per frame, read by reference.
tags: [materials, lighting, uniforms]
timestamp: 2026-07-05T00:00:00Z
---

# Light Uniforms

Module-level singleton of shared lighting uniforms. Updated once per frame
by `Renderer.applyDayCycle()` — not per-material — and consumed by every
material/shader that spreads them into its own uniform map by reference.

## Uniforms

```ts
export const lightUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // view-space sun
  uSunDirWorld: { value: defaultSunDirWorld() }, // world-space sun
  uSunColor: { value: new THREE.Color(1, 1, 1) }, // LINEAR
  uAmbient: { value: new THREE.Color(0.25, 0.25, 0.28) }, // LINEAR
  uShadowFade: { value: 1 }, // 0..1 cast-shadow fade
} satisfies Record<string, THREE.IUniform>;
```

- `uSunDirWorld` drives Sky `sunPosition`, DirectionalLight position, and
  shadow target. Default computed at module load from `SUN_ELEVATION = 28`
  - `SUN_AZIMUTH = 135`.
- `uSunDir` is in VIEW space (post viewMatrix) so cel/rim shaders use
  camera-at-origin convention without a per-frame camera position uniform.
- `uShadowFade` (0..1) written by Renderer from `dayCycle.shadowFade`.

## Update

`updateLightUniforms(uniforms, sunDirWorld, sunColor, ambient, viewMatrix)`
— pure, testable under jsdom. Copies world sun direction, transforms into
view space via `transformDirection(viewMatrix).normalize()`, copies color
and ambient.

`sunWorldPosition(sunDirWorld, target, distance)` — places a target
`distance` units along the sun direction. Used by Renderer for
DirectionalLight position and shadow offset.

## Consumers

All materials read `lightUniforms` by reference — no per-material copies:

| Material         | Module                   | Reads                   |
| ---------------- | ------------------------ | ----------------------- |
| CelMaterial      | `materials/cel.ts`       | uSunDir, uAmbient       |
| CelWaterMaterial | `materials/celWater.ts`  | uSunDirWorld, uSunColor |
| KartVfxLayer     | `kart/KartVfxLayer.ts`   | uAmbient                |
| SkidMarksLayer   | `kart/SkidMarksLayer.ts` | uAmbient                |

## Citations

- [Renderer](/core/renderer.md)
- [CelMaterial](/materials/cel-material.md)
- [VFX](/kart/vfx.md)
- [SkidMarks](/kart/skid-marks.md)
