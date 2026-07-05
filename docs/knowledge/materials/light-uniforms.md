---
type: System
title: Light Uniforms
description: Shared sun/ambient uniform singleton updated by render pass, read by reference.
tags: [materials, lighting, uniforms]
timestamp: 2026-07-05T00:00:00Z
---

# Light Uniforms

Module-level singleton of shared lighting uniforms. `Renderer.applyDayCycle()`
writes camera-independent day-cycle values once per frame; `renderViews()`
then calls `updateLightUniformsFor(camera)` for each view so `uSunDir` matches
that camera's view matrix. Materials consume the shared uniform refs rather
than per-material copies.

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

`updateLightUniforms(uniforms, sunDirWorld, sunColor, ambient, viewMatrix)` is
pure and testable under jsdom. It copies world sun direction, transforms it
into view space via `transformDirection(viewMatrix).normalize()`, then copies
the current sun color and ambient.

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
