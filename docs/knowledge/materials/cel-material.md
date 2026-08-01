---
type: Shader
title: CelMaterial
description: Smooth lambert + soft specular ShaderMaterial (toon bands opt-in), LINEAR output.
tags: [materials, shader, cel-shading]
timestamp: 2026-08-01T00:00:00Z
---

# Schema

Custom `ShaderMaterial`: smooth lambert diffuse + a soft, sun-tinted
Blinn-Phong specular term (per-material `roughness`) by default. The banded
toon diffuse path stays compilable behind `banded:true` / the legacy `cel:true`
alias for byte-identity tests but has no runtime consumers — every world
surface shades smooth now (terrain via `SMOOTH_DIFFUSE`, everything else by
default). Specular is opt-in per surface that wants a highlight.

| Property              | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `vertexColors`        | `true` (road/grass/rock/sand terrain bands on layer 1)                |
| Output color space    | LINEAR                                                                |
| Tone mapping          | ACES + sRGB applied once by `OutputPass`                              |
| Diffuse law           | Smooth lambert by default (`SMOOTH_DIFFUSE` define; `band = NdL`).    |
|                       | `banded:true` (or legacy `cel:true`) opts into the 3-band toon        |
|                       | path — kept compilable for byte-identity tests, no runtime users.     |
|                       | Band GLSL stays define-gated in source; off-path byte-identical.      |
| Specular              | Opt-in soft Blinn-Phong (`SPECULAR` define): half-vector `NdotH`,     |
|                       | exponent mapped from `uRoughness` (lower = shinier), sun-tinted       |
|                       | (`* uSunColor`, never white), `NdotL`-masked, intensity-bounded.      |
| `roughness`           | `uRoughness` uniform (default 0.75); only wired when `specular`       |
|                       | on. Karts ~0.4, painted metal/gantry ~0.45, rock ~0.85, wet water     |
|                       | ~0.15. A few ALU — on at every quality tier (no settings row).        |
| Rim                   | `pow(1-NdotV, uRimPower) * uRimIntensity` (default 0.3, rimPower      |
|                       | 2.0). Per-site tuned: karts 0.3 (clear-coat sheen), props ~0.15,      |
|                       | clouds/wildlife/decals 0 (no silhouette glow).                        |
| Lighting uniforms     | Read by ref from `lightUniforms.ts`; view sun is written per view     |
| Vertex color pipeline | sRGB → LINEAR to match Three.js ColorManagement, ensuring correct     |
|                       | linear-space blending                                                 |
| Normal source         | Raw `HeightMapField` texture (THREE.Texture + origin/size/texels),    |
|                       | reconstructed by finite-differencing in the fragment shader           |
| `heightSmooth`        | `HEIGHT_SMOOTH` define: bilinear interpolation for C0-continuous      |
|                       | normals instead of piecewise-constant                                 |
| `wetness`             | Shared `uWetness` uniform — Environment darkens terrain               |
| `snowCover`           | `SNOW_COVER` define + shared `uSnowCover`/`uSnowWindDir` channel:     |
|                       | whitens upward-facing, flatter surfaces in fbm patches with cool      |
|                       | blue shadows, wind-drift bias, and (SNOW_SPARKLE) lit glints.         |
|                       | Terrain + props opt in; off => no snow uniforms, byte-identical       |
| `snowSparkle`         | Nested `SNOW_SPARKLE` define atop `snowCover` (lit-snow glitter).     |
|                       | Defaults on; low tier passes false so the glint compiles out          |
| `fog`                 | Default ON. `fog:true` + `fogColor/fogNear/fogFar` uniforms;          |
|                       | `USE_FOG`-guarded `mix(color, fogColor, smoothstep(near,far,          |
|                       | -vViewPos.z))`. three.js pushes scene fog each frame; unfogged        |
|                       | scenes (KartPreview) leave USE_FOG undefined -> no haze               |
| `aerial`              | `AERIAL` define (nested in `USE_FOG`): desaturate distant             |
|                       | fragments toward luminance + tint toward `fogColor` on a nearer,      |
|                       | gentler ramp than the haze, so the world recedes cold. Opt-in on      |
|                       | world surfaces (terrain + flora), never karts. Requires fog; no-op    |
|                       | without it. Math mirror `src/materials/aerial.ts`. See                |
|                       | [aerial-perspective](/materials/aerial-perspective.md)                |
| `surfaceDetail`       | `SURFACE_DETAIL` define: fbm albedo mottle + micro-normal             |
|                       | bump on the near terrain only. Requires `heightMap`. Tier-gated       |
|                       | (low off -> no define, no uniforms, byte-identical when disabled).    |
|                       | Shading-only: `heightAt`, trimesh collider, and raycasts untouched    |
| `fade`                | Per-material `uFade` uniform (default 1 = solid) + ordered-dither     |
|                       | discard opening `main()` (Bayer 4x4, `src/materials/fade.ts`), so     |
|                       | opaque geometry dissolves in/out with no alpha blending. Streamed     |
|                       | dressing bundles drive it to hide activation/cull pops. Off =>        |
|                       | no uniform, no dither GLSL, byte-identical fragment (a discard        |
|                       | disables early-Z, so only opt-in draws pay for it)                    |
| `fadeInvert`          | Complementary dither (implies `fade`): same `uFade` but the           |
|                       | INVERSE discard (`FADE_DISCARD_INV_GLSL`, keeps threshold>uFade).     |
|                       | Pair an `fadeInvert` mesh (fading OUT) with a `fade` mesh (fading     |
|                       | IN) under one shared `uFade=t` to partition every pixel between       |
|                       | them — a gap/overlap/z-fight-free cross-dissolve. Terrain LOD tier    |
|                       | swaps use it (old tier out / new tier in)                             |
| `fadeHaze`            | Reveal (NOT dissolve): same `uFade` but instead of a discard it       |
|                       | lerps the fogged colour UP from full `fogColor` inside `USE_FOG`      |
|                       | after the fog mix (`FADE_HAZE_GLSL`), so `uFade=0` is pure            |
|                       | atmosphere (invisible against the hazed horizon) -> `uFade=1` the     |
|                       | normal fogged colour. A streamed prop materialises out of the haze    |
|                       | rather than dither-stippling against the bright sky (holes read as    |
|                       | a white sparkle on a dark tree). Stays opaque (early-Z intact);       |
|                       | requires fog (no-op without it). Dressing big props use it            |
| `geomorph`            | `GEOMORPH` define + per-material `uMorph` uniform (default 0) + a     |
|                       | per-vertex `aMorphTarget` attribute; the VERTEX shader lerps the      |
|                       | vertex HEIGHT `mix(position.y, aMorphTarget, uMorph)` so a mesh       |
|                       | slides toward an adjacent LOD tessellation with no vertex pop. XZ     |
|                       | + normal untouched, so `vWorldXZ` + the heightmap per-pixel normal    |
|                       | stay valid. Off => no define/uniform, guarded block compiles out.     |
|                       | Visual-only: `heightAt`/collider never morph. Terrain LOD             |
|                       | cross-fade meshes pair it with `fade`/`fadeInvert`                    |
| `tempGrade`           | `TEMP_GRADE` define: warm-sun/cool-shade temperature split. Lit       |
|                       | faces lean toward the warm sun tint (`uSunColor`), unlit toward the   |
|                       | cool sky (shade) tint (`uShadeTint`); strength ramps with the         |
|                       | day-cycle `uTempContrast` scalar (0 at noon -> ~0.25 golden hours).   |
|                       | Shared `uShadeTint`/`uTempContrast` uniforms come via                 |
|                       | `lightUniforms` (written per frame from dayCycle); no per-material    |
|                       | binding. Multiply-only weights (luminance-neutral, identity at 0).    |
|                       | On at every tier; no settings row. Off => no define, byte-identical   |
|                       | fragment                                                              |
| `skyEnv`              | `SKY_ENV` define: directional ambient that samples the runtime sky    |
|                       | cubemap (`uSkyEnv`, shared via `lightUniforms`) with the world        |
|                       | normal for zenith-blue-above / warm-horizon-grazing, blended toward   |
|                       | the flat day-cycle ambient by `uSkyEnvStrength` (default 0.5). Uses   |
|                       | `textureCube(uSkyEnv, normalize(vWorldNormal))` at mip 0 (no          |
|                       | texture-lod ext in three r185; cube keeps `LinearMipmapLinearFilter`  |
|                       | for future blur). Widens the `vWorldNormal` varying guard from        |
|                       | `SNOW_COVER` to also cover `SKY_ENV`. Uniforms are shared by-ref      |
|                       | (already present via the `...lightUniforms` spread; no per-material   |
|                       | wiring). Tier-gated off on low (null `uSkyEnv` never sampled) via     |
|                       | `src/terrain/terrainCelMaterials.ts`. Off => no define, no block,     |
|                       | fragment byte-identical                                               |
| `envReflect`          | `ENV_REFLECT` define: fresnel-weighted, roughness-blurred sky-cube    |
|                       | reflection for bodywork that reads as painted metal, not chrome.      |
|                       | `R = reflect(-Vworld, Nworld)` in WORLD space (`Vworld` from          |
|                       | `cameraPosition - vWorldPos`; adds a `vWorldPos` varying), sampled    |
|                       | at `textureCubeLodEXT(uSkyEnv, R, lod)` (mapped to native             |
|                       | `textureLod` in three's WebGL2 prefix). `lod = floor(uEnvRoughness *  |
|                       | (uSkyEnvMipCount-1) + 0.5)`mirrors the pure`roughnessToMipLevel`.     |
|                       | Downward rays (`R.y < 0`) fall back to `uGroundTint` (biome grass/    |
|                       | road avg). Weight `pow(1-NdotV,3) * uEnvStrength` keeps face-on       |
|                       | liveries saturated (~30% max at grazing). Per-material `uEnvStrength` |
|                       | (default 0.25) + `uEnvRoughness` (reuses `roughness`, default 0.4);   |
|                       | `uSkyEnv`/`uSkyEnvMipCount`/`uGroundTint` shared via `lightUniforms`. |
|                       | Tier gate: the whole sample+contribution sits inside                  |
|                       | `if (uSkyEnvMipCount > 0.0)` so low tier (skyEnvSize 0) is identity   |
|                       | at runtime without a material rebuild + the null cube is never        |
|                       | sampled. Kart body/accent opt in; distance LOD swaps it out (see      |
|                       | [kart-mesh](/kart/kart-mesh.md)). Off => no define/uniforms,          |
|                       | byte-identical fragment                                               |

The fbm noise + GLSL snippets live in `src/materials/terrainDetail.ts`,
which provides the JS mirror and exported GLSL strings inlined behind the
`SURFACE_DETAIL` define. See
[Terrain Surface Detail](/materials/terrain-detail.md).

The vertex program (`CEL_VERT`) and the fragment builder (`celFragmentShader`,
which concatenates the WETNESS / SNOW_COVER / SURFACE_DETAIL / AERIAL / fade /
TEMP_GRADE / SKY_ENV / ENV_REFLECT blocks behind their defines) live in
`src/materials/celShader.ts` — split out of `src/materials/cel.ts` so that file
stays under the 600-line cap once snow cover
and aerial both landed. `cel.ts` keeps the `CelMaterial` class + uniform wiring
and imports the two shader sources. Off-path concatenation stays byte-identical.

## Snow cover

Snow accumulation GLSL lives in `src/materials/snowCover.ts` (`SNOW_HEADER`,
`SNOW_APPLY`, `SNOW_DEFAULTS`), inlined behind the `SNOW_COVER` define. The
shared value-noise fns (hash2/vnoise/fbm) are declared once at fragment
top-level whenever `SURFACE_DETAIL` OR `SNOW_COVER` needs fbm — no double
definition. `snowUniform` (defined in `src/materials/snowCover.ts`, re-exported
from `src/materials/cel.ts`) holds the by-reference
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

Used on layers 0 and 1 for smooth-shaded world geometry. Karts/props use
CelMaterial for shading; they carry no outline (the black inverted-hull
silhouette shells were removed for the realism art direction). Distant
baked-foliage billboards use `ImpostorMaterial` (`src/materials/impostor.ts`),
which mirrors the smooth lambert relight so far cards match near meshes.

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
// CelMaterial fragment shader — smooth diffuse + soft specular (default path)
vec3 L = normalize(uSunDir);
float NdL = clamp(dot(N, L), 0.0, 1.0);
float band = NdL;                       // SMOOTH_DIFFUSE (default); bands opt-in
vec3 diffuse = base * uSunColor * band; // shadow term multiplies the sun only
#ifdef SPECULAR                          // opt-in, sun-tinted, NdotL-masked
vec3 H = normalize(L + V);
float shininess = pow(2.0, mix(10.0, 3.0, uRoughness));
diffuse += uSunColor * pow(dot(N, H), shininess) * uSpecularIntensity * NdL;
#endif
vec3 color = diffuse + base * uAmbient; // ambient floor prevents pure black
// SKY_ENV (opt-in, tier-gated): replaces uAmbient with mix(uAmbient,
// textureCube(uSkyEnv, normalize(vWorldNormal)), uSkyEnvStrength).
// ENV_REFLECT (opt-in, kart bodywork): world-space reflection of the sky cube,
// if (uSkyEnvMipCount > 0.0) color += envCol * pow(1-NdotV,3) * uEnvStrength,
// where envCol = textureCubeLodEXT(uSkyEnv, reflect(-Vworld,Nworld), lod) for
// upward rays (lod from uEnvRoughness) or uGroundTint for downward rays.
// TEMP_GRADE (opt-in): warm-sun/cool-shade split, multiply-only weights keyed
// on the lit term (band, shadow-masked); amplitude from uTempContrast.
// #ifdef TEMP_GRADE
// color *= mix(coolW, warmW, lit);
// #endif
// output LINEAR, ACES+sRGB applied later
```

# Citations

- [Renderer](/core/renderer.md)
- [DynamicSky](/environment/dynamic-sky.md)
- [Render Layers](/conventions/render-layers.md)
- [Water Shading](/materials/water-shading.md)
