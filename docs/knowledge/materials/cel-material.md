---
type: Shader
title: CelMaterial
description: Custom cel-shaded ShaderMaterial with toon bands, vertex colors, LINEAR output.
tags: [materials, shader, cel-shading]
timestamp: 2026-07-14T23:55:00Z
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
| `snowCover`           | `SNOW_COVER` define + shared `uSnowCover`/`uSnowWindDir` channel:  |
|                       | whitens upward-facing, flatter surfaces in fbm patches with cool   |
|                       | blue shadows, wind-drift bias, and (SNOW_SPARKLE) lit glints.      |
|                       | Terrain + props opt in; off => no snow uniforms, byte-identical    |
| `snowSparkle`         | Nested `SNOW_SPARKLE` define atop `snowCover` (lit-snow glitter).  |
|                       | Defaults on; low tier passes false so the glint compiles out       |
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
| `fadeInvert`          | Complementary dither (implies `fade`): same `uFade` but the        |
|                       | INVERSE discard (`FADE_DISCARD_INV_GLSL`, keeps threshold>uFade).  |
|                       | Pair an `fadeInvert` mesh (fading OUT) with a `fade` mesh (fading  |
|                       | IN) under one shared `uFade=t` to partition every pixel between    |
|                       | them — a gap/overlap/z-fight-free cross-dissolve. Terrain LOD tier |
|                       | swaps use it (old tier out / new tier in)                          |
| `geomorph`            | `GEOMORPH` define + per-material `uMorph` uniform (default 0) + a  |
|                       | per-vertex `aMorphTarget` attribute; the VERTEX shader lerps the   |
|                       | vertex HEIGHT `mix(position.y, aMorphTarget, uMorph)` so a mesh    |
|                       | slides toward an adjacent LOD tessellation with no vertex pop. XZ  |
|                       | + normal untouched, so `vWorldXZ` + the heightmap per-pixel normal |
|                       | stay valid. Off => no define/uniform, guarded block compiles out.  |
|                       | Visual-only: `heightAt`/collider never morph. Terrain LOD          |
|                       | cross-fade meshes pair it with `fade`/`fadeInvert`                 |

The fbm noise + GLSL snippets live in `src/materials/terrainDetail.ts`,
which provides the JS mirror and exported GLSL strings inlined behind the
`SURFACE_DETAIL` define. See
[Terrain Surface Detail](/materials/terrain-detail.md).

The vertex program (`CEL_VERT`) and the fragment builder (`celFragmentShader`,
which concatenates the WETNESS / SNOW_COVER / SURFACE_DETAIL / AERIAL / fade
blocks behind their defines) live in `src/materials/celShader.ts` — split out of
`src/materials/cel.ts` so that file stays under the 600-line cap once snow cover
and aerial both landed. `cel.ts` keeps the `CelMaterial` class + uniform wiring
and imports the two shader sources. Off-path concatenation stays byte-identical.

## Snow cover

Snow accumulation GLSL lives in `src/materials/snowCover.ts` (`SNOW_HEADER`,
`SNOW_APPLY`, `SNOW_DEFAULTS`), inlined behind the `SNOW_COVER` define. The
shared value-noise fns (hash2/vnoise/fbm) are declared once at fragment
top-level whenever `SURFACE_DETAIL` OR `SNOW_COVER` needs fbm — no double
definition. `snowUniform` (in `src/materials/cel.ts`) holds the by-reference
`uSnowCover` level (0..1) + world `uSnowWindDir` (default +X); Environment
writes them once/frame so a single write fans out to every terrain chunk +
opted-in prop (mirrors `wetnessUniform`).

Snow settles on upward-facing (`Nworld.y` under `HEIGHT_MAP`, else
`vWorldNormal.y`), flatter surfaces inside fbm patches; the mask is strictly 0
at cover 0 and the block sits behind `if (uSnowCover > 0.0)`, so it is near-free
and byte-identical while not snowing. Painterly realism layers on top: albedo
cools toward `uSnowShadowColor` in shade (blue shadows), coverage biases toward
windward-facing normals (`uSnowWindDir`), and `SNOW_SPARKLE` adds sparse hash
glints on lit, camera-facing snow. Shading-only: `heightAt`, the trimesh
collider, and suspension raycasts are untouched (mirrors `SURFACE_DETAIL`). The
per-preset accumulation target is the `snowCover` weather channel
([weather](/environment/weather.md)).

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
