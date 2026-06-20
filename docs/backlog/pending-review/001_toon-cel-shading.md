# 001 Toon cel-shading + outlines (reimplementation)

Status: pending-review (implemented 2026-06-21 on branch feat/001-cel-shading)

## Context

Prior impl shipped as `pending-review/001` commit 26f8622. Used
`MeshToonMaterial` + inverted-hull outline. Rendered fine but has real issues;
reimplementing as a custom cel material system instead of patching built-ins.

Prior impl problems:

- `flatGeometry()` (toon.ts:55) de-indexes + clones every faceted geo ->
  ~3x VRAM + extra uploads. Bakes flat normals into geometry because
  `MeshToonMaterial` ctor lacks a flatShading flag in three@0.169.
- `addOutline()` (toon.ts:87) shares source geo -> inverted hull expands
  along SMOOTH vertex normals. On faceted shapes (icosa/dodeca foliage,
  rocks) outline silhouette disagrees with the visible faceted faces.
- `makeOutline()` (toon.ts:66) uses world-space `thickness` -> outlines
  thin out at distance, balloon up close.
- Outlines only set `renderOrder = -1`, no depthWrite/polygonOffset ->
  z-fighting on coplanar parts (spoiler, seat).
- No dispose path -> outline mesh + material leak on scene rebuild.
- Pure 3-band lambert, no rim/specular -> kart body looks muddy.

## Goal

Cartoony cel-shaded look via a custom ShaderMaterial pipeline:

- cel bands + rim (+ optional specular band) in one fragment shader
- per-mesh flatShading toggle (caller picks) via dFdx/dFdy normals (WebGL2)
- fixed inverted-hull outline for solid objects (kart + props)
- post-process Sobel edge-detect outline for large surfaces (terrain + walls)
- tests + AGENTS-mandated lint/format

## Architecture (new)

```text
src/materials/
  lightUniforms.ts   # shared uniforms: sunDir, sunColor, ambient. Renderer
                     #   updates once/frame; CelMaterial + outline read it.
  cel.ts             # CelMaterial (custom ShaderMaterial). lambert snapped
                     #   to N bands, rim term, optional specular band,
                     #   flatShading toggle via fragment derivs.
  outline.ts         # InvertedHullMaterial (fixed) + addOutline(). Screen-space
                     #   thickness (t / -mvPosition.z), view-space face normal,
                     #   depthWrite=false, polygonOffset. Solid layer only.
  postOutline.ts     # Custom ShaderPass: Sobel on depth+normal RT, black lines
                     #   masked to terrain layer.
  gradient.ts        # stepped 1D gradient DataTexture (kept for tuning).
src/core/
  Renderer.ts        # EffectComposer + normal/depth RT, lightUniforms update,
                     #   layer-aware render (layer 0 solid, layer 1 terrain).
src/materials/toon.ts  # DELETED once Kart + TestArena migrated off.
```

Layers:

- 0 = solid (kart + props): inverted-hull outline
- 1 = terrain/walls: post-process outline only

## Config (lint/format/tests)

Provided by **000** (tooling/quality-gate item): eslint + prettier + vitest +
the `.githook/` dispatcher + fragments, wired via
`git config core.hooksPath .githook`. 001 consumes the harness; it does not add
it. Each commit below must pass `npm run typecheck && lint && test` via that
harness. See `open/000`.

## Commits (each atomic + green: typecheck + lint + test via 000 harness)

Prerequisite: **000** lands the lint/format/test harness + hooks first.
Commits below assume `npm run typecheck && lint && test` is available.

1. `feat(materials): add lightUniforms shared chunk` + Renderer update test
2. `feat(materials): add CelMaterial w/ bands, rim, flat-shading toggle`
   - tests: uniform defaults, flatShading toggles fragment branch, dispose
3. `feat(materials): rewrite inverted-hull outline (screen-space, fixed)`
   - tests: thickness scales as `t / -mvPosition.z`, dispose removes child
4. `feat(render): wire EffectComposer + normal/depth pass + post-outline`
   - test: composer present, terrain layer renders to outline RT
5. `refactor(kart,tracks): migrate to CelMaterial + fixed outlines`
   - Kart.ts: 6 meshes -> `makeCel({flatShading})`, outlines via fixed hull
   - TestArena.ts: terrain/walls -> layer 1; trees/rocks -> solid + hull
   - delete `src/materials/toon.ts`
   - visual check: `npm run dev`, no black screen
6. `docs: update backlog 001 + todo + README for reimplementation`

## Risks

- Tonemapping/linear pipeline: custom ShaderMaterial doesn't auto-convert.
  Plan: render cel linear into composer's linear RT, `linearToOutputTexel`
  in final ShaderPass. Spike at commit 2; fallback is per-shader ACESFilmic apply.
- Post-outline on terrain needs depth+normal MRT; three doesn't expose scene
  depth to ShaderPass by default. Write a NormalPass + `DepthTexture` RT.
- Layer filtering: `camera.layers` bit mask separates solid from terrain pass.

## Acceptance

- [x] 0 `MeshStandardMaterial` remain
- [x] 0 references to `src/materials/toon.ts`
- [x] Kart + props render with cel bands + rim + crisp screen-space outlines
- [~] Terrain/walls show post-process Sobel outlines, no hull z-fighting
      (pipeline + layer split wired; flat ground/walls yield few Sobel edges
      until 003 adds terrain height variation. Solid props carry the toon
      look meanwhile.)
- [x] Per-mesh flatShading toggle produces faceted vs smooth normals on demand
- [x] `npm run typecheck && lint && test` green (via 000 harness, 20/20 tests)
- [x] No black screen at `npm run dev` (verified via dev server pixel sample)

## Implementation (2026-06-21)

Commits (branch `feat/001-cel-shading`):

- `feat(materials): add lightUniforms shared chunk` —
  src/materials/lightUniforms.ts (uSunDir view-space, uSunColor, uAmbient)
  + pure updateLightUniforms; Renderer.render refreshes once/frame.
- `feat(materials): add CelMaterial w/ bands, rim, flat-shading toggle` —
  src/materials/cel.ts (custom ShaderMaterial, view space, shader-side
  banding, rim, optional specular band, #define FLAT via dFdx/dFdy) +
  src/materials/gradient.ts (stepped gradient reference helper).
- `feat(materials): rewrite inverted-hull outline (screen-space, fixed)` —
  src/materials/outline.ts (InvertedHullMaterial + addOutline +
  removeOutline). Clip-space offset `viewNormal.xy * uThickness * clip.w`
  -> constant pixel width (deviates from the plan's literal `t / -mvPos.z`,
  which shrinks at distance; see troubleshooting log).
- `feat(render): wire EffectComposer + normal/depth pass + post-outline` —
  src/materials/postOutline.ts (PostOutlinePass: layer-1 normal+depth RT
  with DepthTexture, Sobel composite masked to terrain) + Renderer rework
  (lazy EffectComposer: RenderPass -> PostOutlinePass -> OutputPass; single
  ACES pass).
- `refactor(scene): migrate kart + tracks to CelMaterial + fixed outlines` —
  Kart.ts + TestArena.ts on makeCel/addOutline; ground+stripes+walls ->
  layer 1; trees/rocks makeCel({flatShading:true}) (no flatGeometry);
  src/materials/toon.ts deleted.

Exec decisions (resolved at exec):

- View-space lighting (uSunDir transformed by camera viewMatrix each frame)
  so cel + rim assume camera-at-origin and no per-frame camera-position
  uniform is needed.
- Constant pixel-width outline multiplies by clip.w, not divides (plan's
  `t / -mvPos.z` is the bug, not the fix). Test guards the shader source.
- depthWrite=false + renderOrder=-1 on outlines (plan); ~1px
  ground-contact overdraw trade-off accepted for v1, verified visually.
- Composer built lazily on first render (camera is created after the
  Renderer in Game).
- Custom CelMaterial outputs LINEAR; OutputPass applies ACES + sRGB once
  (renderer skips tone mapping on off-screen targets -> no double ACES).
- Deviations from literal plan formulas are documented in
  docs/troubleshooting/2026-06-21_001-cel-shading.md.

## Defaults

- bands: 3 (exposed uniform)
- rim: on, color #ffffff, power 2.0, intensity 0.3
- specular band: off by default, opt-in via `makeCel({specular:true})`
- post-outline color: pure black, ~1px at 1080p
- sky: excluded from post-outline layer
- batching (InstancedMesh for props): out of scope, future backlog

## Previous implementation

Superseded. Originally commit 26f8622 — `src/materials/toon.ts` with
`toonGradient`/`makeToon`/`flatGeometry`/`makeOutline`/`addOutline`.
Deleted in reimpl commit 5.

## Depends on

000 (lint/format/test harness + hooks). Otherwise foundational — 002, 003,
004 build on this.
