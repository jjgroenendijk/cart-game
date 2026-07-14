---
type: Shader
title: CelMaterial
description: Custom cel-shaded ShaderMaterial with toon bands, vertex colors, LINEAR output.
tags: [materials, shader, cel-shading]
timestamp: 2026-07-12T00:00:00Z
---

# Schema

Custom `ShaderMaterial` providing cel-shaded toon rendering.

| Property              | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `vertexColors`        | `true` (road/grass/rock/sand terrain bands on layer 1)             |
| Output color space    | LINEAR                                                             |
| Tone mapping          | ACES + sRGB applied once by `OutputPass`                           |
| Lighting uniforms     | Read by ref from `lightUniforms.ts`; view sun is written per view  |
| Vertex color pipeline | sRGB → LINEAR to match Three.js ColorManagement, ensuring correct  |
|                       | linear-space blending                                              |
| Normal source         | Raw `HeightMapField` texture (THREE.Texture + origin/size/texels), |
|                       | reconstructed by finite-differencing in the fragment shader        |
| `heightSmooth`        | `HEIGHT_SMOOTH` define: bilinear interpolation for C0-continuous   |
|                       | normals instead of piecewise-constant                              |
| `wetness`             | Shared `uWetness` uniform — Environment darkens terrain            |
| `fog`                 | Default ON. `fog:true` + `fogColor/fogNear/fogFar` uniforms;       |
|                       | `USE_FOG`-guarded `mix(color, fogColor, smoothstep(near,far,       |
|                       | -vViewPos.z))`. three.js pushes scene fog each frame; unfogged     |
|                       | scenes (KartPreview) leave USE_FOG undefined -> no haze            |
| `aerial`              | `AERIAL` define (nested in `USE_FOG`): desaturate distant          |
|                       | fragments toward luminance + tint toward `fogColor` on a nearer,   |
|                       | gentler ramp than the haze, so the world recedes cold. Opt-in on   |
|                       | world surfaces (terrain + flora), never karts. Requires fog; no-op |
|                       | without it. Math mirror `src/materials/aerial.ts`. See             |
|                       | [aerial-perspective](/materials/aerial-perspective.md)             |
| `surfaceDetail`       | `SURFACE_DETAIL` define: fbm albedo mottle + micro-normal          |
|                       | bump on the near terrain only. Requires `heightMap`. Tier-gated    |
|                       | (low off -> no define, no uniforms, byte-identical when disabled). |
|                       | Shading-only: `heightAt`, trimesh collider, and raycasts untouched |
| `fade`                | Per-material `uFade` uniform (default 1 = solid) + ordered-dither  |
|                       | discard opening `main()` (Bayer 4x4, `src/materials/fade.ts`), so  |
|                       | opaque geometry dissolves in/out with no alpha blending. Streamed  |
|                       | dressing bundles drive it to hide activation/cull pops. Off =>     |
|                       | no uniform, no dither GLSL, byte-identical fragment (a discard     |
|                       | disables early-Z, so only opt-in draws pay for it)                 |

The fbm noise + GLSL snippets live in `src/materials/terrainDetail.ts`,
which provides the JS mirror and exported GLSL strings inlined behind the
`SURFACE_DETAIL` define. See
[Terrain Surface Detail](/materials/terrain-detail.md).

`src/materials/gradient.ts` exports `celGradient(bands)`, which builds a
stepped 1D gradient DataTexture. It is kept as a tuning/reference helper —
CelMaterial does equivalent banding in-shader and does NOT sample this
texture by default, but the values it produces are the reference used by
the cel unit tests.

Used on layers 0 and 1 for cel-shaded geometry. Karts/props use
CelMaterial for shading but the outline is a separate `InvertedHullMaterial`
(from `materials/outline.ts`), added as child mesh via `addOutline()`.

Shadow term (under `USE_SHADOWMAP`): `getShadow(...) * uShadowFade` —
the fade uniform (`uShadowFade`, default 1) is driven by
`dayCycleState.shadowFade` via `Renderer.applyDayCycle`.

Distance fog (default on) is what dissolves distant world geometry into the
horizon: without it the streamed-terrain edge is a hard cutoff (only
`celWater` used to haze). `fog:false` compiles the `USE_FOG` block out
(byte-identical fallback) for materials in an unfogged scene. The scene fog
far plane is capped to the bounded world by the Renderer
([render pipeline](/data-flows/render-pipeline.md)); terrain draw distance is
scaled to reach it so the haze hides the boundary.

# Examples

```glsl
// CelMaterial fragment shader — banding sketch
vec3 lightDir = normalize(uSunDir);
float NdotL = dot(normal, lightDir);
float band = floor(NdotL * uBands) / uBands;
vec3 diffuse = uAmbient + (1.0 - uAmbient) * band;
// output LINEAR, ACES+sRGB applied later
```

# Citations

- [Renderer](/core/renderer.md)
- [Render Layers](/conventions/render-layers.md)
- [Outlines](/materials/outlines.md)
- [Water Shading](/materials/water-shading.md)
