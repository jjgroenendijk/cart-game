---
type: Shader
title: Foliage Impostors
description: Runtime-baked albedo+normal atlas + instanced yaw billboards, relit via cel lighting.
tags: [materials, shader, impostor, foliage, lod, dressing]
timestamp: 2026-07-14T23:59:00Z
---

# Schema

Distant big flora (trees) is drawn as instanced camera-facing quads
(billboards) sampling a runtime-baked atlas, instead of full 3D geometry, so
foliage reaches the fog horizon cheaply. Near flora keeps full meshes; past an
impostor-start radius the streaming layer swaps meshes for cards.

Two modules:

- `src/materials/impostor.ts` — `ImpostorMaterial` + pure helpers.
- `src/environment/ImpostorField.ts` — runtime GPU bake + the billboard field.

## Material inputs, not baked lighting

The atlas stores MATERIAL INPUTS, never final lighting:

| Atlas  | Contents                                                     |
| ------ | ------------------------------------------------------------ |
| albedo | LINEAR base colour (rgb) + silhouette coverage (alpha)       |
| normal | packed side-view surface normal (`rgb = normal * 0.5 + 0.5`) |

`ImpostorMaterial` RELIGHTS them every frame with the SAME shared
`lightUniforms` (`uSunDir`/`uSunColor`/`uAmbient`) and the SAME `USE_FOG` haze
as `CelMaterial`, so cards track the day/night cycle and match the near meshes.
The relight is smooth lambert — `float band = NdL` — matching CelMaterial's
default `SMOOTH_DIFFUSE` path (the `smoothstep(1.0 - uBandEdge, 1.0, f)` band
expression is CelMaterial's opt-in banded path, NOT used here). A unit test
pins `float band = NdL` present and `smoothstep(1.0 - uBandEdge, 1.0, f)`
absent. Output is LINEAR (OutputPass applies ACES + sRGB). `cel.ts` is left
byte-identical (no extraction), so all pre-existing cel invariants hold.

## Yaw billboard + relit normal

Billboard mode is YAW-ONLY (octahedral multi-view is a follow-up only if
clearly needed). The vertex shader rebuilds the card basis per vertex from the
world `cameraPosition`: `facing` = horizontal camera direction (`toCam.y = 0`),
`up` = world +Y, `right = cross(up, facing)`. The quad (unit `PlaneGeometry`,
corners `[-0.5,0.5]`) is sized by the per-instance `aSize` (world width/height,
already scaled) and rooted at the instance base (`y in [0,1]*height`) so the
trunk foot sits on the terrain like the mesh. The decoded card-space normal is
expressed in the `(right, up, facing)` basis, so lighting rotates WITH the
billboard, then world -> view for the cel `dot(N, L)`. The silhouette is an
alpha-test discard (`uAlphaTest`, default 0.5) — opaque, depth-writing, never
alpha blending. `uFade` (shared `fade.ts` ordered dither) drives the stream
cross-dissolve.

## Atlas layout (pure)

`impostorAtlasLayout(cells)` packs prototype views into a square-ish grid
(`cols = ceil(sqrt(n))`, `rows = ceil(n/cols)`); `impostorCellRect(index,
layout)` returns the row-major `{u0,v0,du,dv}` sub-rect (bottom-left origin, GL
texture space). Both are pure + deterministic so the bake viewports and the
per-instance `aUv` attributes agree without a GL context, and are unit-tested.

## Runtime bake (GPU only)

`bakeImpostorAtlas(renderer, prototypes, {cellPixels})` renders each prototype
ONCE into an albedo + normal `WebGLRenderTarget` atlas (procedural — NEVER a
committed texture). Each cell is an orthographic side view (camera along -Z)
framed to the prototype's bounding box; the albedo pass draws the vertex-colour
base UNLIT (`MeshBasicMaterial`, transparent clear so alpha = silhouette) and
the normal pass writes the packed view normal (a tiny bake shader). The bake
camera looks along -Z, so its view space is exactly the card frame the material
reconstructs. Returns an `ImpostorAtlas` (`albedo`, `normal`, `layout`, per-cell
world size, `cellForKind`, `dispose`). This needs a live WebGL2 context and is
RUNTIME-ONLY — not exercised by the jsdom/node test suites (which are GL-free).

## Streaming swap

`ImpostorField(placements, atlas)` builds ONE instanced billboard mesh (one draw
call) for a chunk's big placements, sized + UV-mapped per instance from the
atlas cells; placements whose kind was not baked are dropped. It has NO
colliders and never touches physics. `useImpostor(dist, startRadius,
hysteresis, current)` is the pure selection: past `startRadius` the card shows,
with hysteresis holding the current state across the boundary so a bundle on the
edge does not flap. See [Dressing](/environment/dressing.md#foliage-impostors)
for the `PropField`/`DressingChunkManager` integration.

# Citations

- [CelMaterial](/materials/cel-material.md)
- [Light Uniforms](/materials/light-uniforms.md)
- [Dressing](/environment/dressing.md)
- [Quality](/core/quality.md)
