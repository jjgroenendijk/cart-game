---
type: Shader
title: CelMaterial
description: Custom cel-shaded ShaderMaterial with toon bands, vertex colors, LINEAR output.
tags: [materials, shader, cel-shading]
timestamp: 2026-07-05T00:00:00Z
---

# Schema

Custom `ShaderMaterial` providing cel-shaded toon rendering.

| Property              | Value                                                               |
| --------------------- | ------------------------------------------------------------------- |
| `vertexColors`        | `true` (road/grass/rock/sand terrain bands on layer 1)              |
| Output color space    | LINEAR                                                              |
| Tone mapping          | ACES + sRGB applied once by `OutputPass`                            |
| Lighting uniforms     | Read by ref from `lightUniforms.ts`, written once/frame by Renderer |
| Vertex color pipeline | sRGB → LINEAR to match ColorManagement                              |
| Normal source         | `HeightSource.normalAt` for world-consistent cel bands              |

Also used on layer 0 for kart/props with inverted-hull outlines.

# Examples

```glsl
// CelMaterial fragment shader — banding sketch
vec3 lightDir = normalize(uSunDirection);
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
