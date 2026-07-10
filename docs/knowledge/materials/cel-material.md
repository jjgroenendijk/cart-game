---
type: Shader
title: CelMaterial
description: Custom cel-shaded ShaderMaterial with toon bands, vertex colors, LINEAR output.
tags: [materials, shader, cel-shading]
timestamp: 2026-07-05T00:00:00Z
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
| `wetness`             | Shared `uWetness` uniform (054) — Environment darkens terrain      |
| `surfaceDetail`       | `SURFACE_DETAIL` define (069): fbm albedo mottle + micro-normal    |
|                       | bump on the near terrain only. Requires `heightMap`. Tier-gated    |
|                       | (low off -> no define, no uniforms, byte-identical to pre-069).    |
|                       | Shading-only: `heightAt`, trimesh collider, and raycasts untouched |

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
