# 021 Terrain shade-quantisation (heightmap-texel normal)

Status: pending-review (implemented; awaiting browser verification)

## Context

Symptom (post-#26): visible grid of squares on the terrain, each cell a
slightly different shade than its neighbour. Distinct from the diagonal/
diamond cel-band fold #26 already killed (`03be333`, per-pixel heightmap
normal). This is a NEW, different rasterisation.

Root cause = the per-pixel normal is quantised to the heightmap texel grid.

PR #26 made `CelMaterial` derive N per fragment from a baked height texture
(`src/materials/cel.ts:138-160`, `HEIGHT_MAP`). That texture is a 256x256
float `DataTexture`, **NearestFilter**, finite-differenced at a 1-texel
offset (`src/terrain/TerrainChunkManager.ts:111,247-276`; texel 200/256 =
0.78125 m). Nearest sampling makes each of the 4 neighbour taps (hL/hR/
hD/hU) piecewise-constant -> the central-difference normal N is constant
within each ~0.78 m texel cell and steps at cell borders. `N.L` therefore
steps every 0.78 m, so the cel shade (`base * sun * band + base * amb`,
bandEdge 0.12 smoothstep across the 3 bands) renders one slightly different
shade per ~0.78 m cell -> the grid of squares.

PROVEN against the live build (race cam, 2026-06-27): replicated the
shader's 4-tap normal from the live `uHeightMap` data along a 12 m world
line at 0.01 m resolution. `N.L` is identical within each cell and jumps at
**0.78 m intervals** (step list `[0.78, 0.78, 0.78, ...]`, 15 steps / 12 m).
So the cell size of the visible squares == the heightmap texel size, by
construction. Vertex colors (`colorAt`) and mesh quad size (~1 m near,
incommensurate with 0.78 m -> moire, secondary) are NOT the driver: the
shade varies per cell even on uniform-colour regions because N varies.

Secondary contributors (keep, lower priority):

- Binary per-vertex rock/sand colors (`heightmap.ts:156-192` colorAt:
  `slope >= rockSlope`, `h < sandLevel`) -> flat same-colour blocks with
  quad-aligned edges at zone boundaries. Reads as squares at rock outcrops
  - sand shorelines, not the pervasive "each cell slightly different."
- Coarse mid/far mesh (segmentTier mid 12 / far 6 -> ~2 m / ~4 m quads)
  -> blockiness at distance.

## Scope

021 fixes ONLY the blocky-grid symptom (issue 1): terrain reads rasterised,
~0.78 m square cells, stepped road/grass/sand, blocky light bands, stippled
shadows. Two other reported issues are NOT 021 and stay tracked separately:

- Night darkness wiping in from the bottom (dusk->night): binary shadow
  toggle plus a finite shadow frustum at grazing sun angles.
- Morning shadows popping in at dawn: the same binary castShadow flip.

Both belong to a shadow-fade fix (dayCycle.shadowFade over a 3->18 deg
elevation band, a uShadowFade term in the cel shadow path, Renderer keeps
the shadow map alive across the band) -> own task, not 021. The blocky
normal amplifies the night wipe (uneven cel darkening), so 021 indirectly
helps issue 2 but does not own it.

## Goal

Make the per-pixel normal continuous (triangulation- AND texel-independent)
so cel shades vary smoothly and the ~0.78 m square grid disappears, while
keeping the #26 architecture (per-pixel heightmap normal, no float-linear
dependency, mesh/collider parity). Layered fix (A' primary + D + B):

- A' (PRIMARY): bilinear-interpolate the height taps in the `HEIGHT_MAP`
  shader block. Keep NearestFilter + RGBA FloatType (float-linear is NOT
  guaranteed core in WebGL2, `2026-06-27_terrain-invisible-heightmap-
normal.md:148-154`; manual bilinear is the device-safe equivalent).
  Height -> C0 -> normal piecewise-linear -> shades smooth. Optional
  heightTexels 256 -> 384 so bilinear has finer data to mix.
- D (SECONDARY): smoothstep the rock/sand thresholds in `colorAt` over
  moderate windows so zone edges are not quad-faceted blocks.
- B (TERTIARY): densify mid/far segment tiers (mid 12 -> 20, far 6 -> 12)
  for distant blockiness.

## Non-goals

- Revert #26 (correct architecture; only the tap filtering changes).
- Reimplement `heightAt` analytically in GLSL (spline-field data texture +
  GLSL simplex) -> truly continuous + texel-free. "Terrain shading v2";
  deferred follow-on if A' bilinear is still insufficient.
- Switch the height texture to LinearFilter (silently breaks on devices
  lacking OES_texture_float_linear; the troubleshooting doc forbids it).
- Bake a separate RGBA8 world-normal texture now (LinearFilter). Device-safe
  (RGBA8 linear is core; no float-linear ext), but a 2nd architecture 021
  does not sanction, and any baked GLOBAL texture is a fixed-world assumption
  023 (infinite terrain) must refactor to streaming -> premature. Defer to
  023; see "Streaming (023 forward note)".
- Touching the cel look of karts/props (HEIGHT_MAP is terrain-only).
- Changing `heightAt`/collider semantics or the mesh/collider parity
  invariant (`src/AGENTS.md:74`).

## Streaming (023 forward note)

The baked height texture spans the WHOLE fixed world (one 256/384^2 texture
over 200 m, origin = -worldSize/2). That is a fixed-world assumption; 023
(infinite procedural terrain) replaces it with a streaming source (moving
window or per-tile texture). A' is chosen so the SHADER carries over
unchanged: only the texture binding becomes streaming-aware, not the
bilinear + central-difference math. Open 023 wrinkle: finite-difference taps
at tile edges read the neighbour tile -> cross-tile normal seam; solve at
023 with overscan border texels (standard streaming-heightmap technique).
Longer-term 023 options, decide THEN: normal-map-per-tile (self-contained,
no cross-tile tap reads -> seamless) or analytic normals in-shader (the
deferred "v2": truly infinite, no texture). Do not pre-commit either here.

## Architecture (change)

```text
src/materials/
  cel.ts            # HEIGHT_MAP block: add a bilinear height fn sampleH(xz)
                    #   = 4 NearestFilter taps mixed by the texel-fractional
                    #   offset (keep NearestFilter). Central-difference calls
                    #   sampleH at +-1 texel for hL/hR/hD/hU (16 taps total,
                    #   vs 4 today). Normal becomes piecewise-linear ->
                    #   shades smooth. Add a `heightSmooth?: boolean` opt
                    #   (default on when heightMap set) so the path is
                    #   togglable; off -> today's 4-tap nearest path.
  cel.test.ts       # HEIGHT_MAP source asserts: bilinear mix present,
                    #   4-tap fallback guarded by the opt, uniform set stable.
src/terrain/
  heightmap.ts      # colorAt: replace `if (slope >= rockSlope)` + `if (h <
                    #   sandLevel)` with smoothstep blends. Moderate windows:
                    #   rock over ~0.15 slope around rockSlope; sand over
                    #   ~1.0 m height around sandLevel. Add
                    #   TerrainConfig.rockBlendSlope + sandBlendHeight
                    #   (defaulted). Restructure: base = grass/road blend
                    #   (existing), lerp rock by slope weight, then sand by
                    #   height weight.
  heightmap.test.ts # colorAt gradient asserts: rock/sand weight rises
                    #   monotonically across the blend window, no discrete
                    #   step; road corridor stays crisp.
  terrainLod.ts     # segmentTier: mid 12 -> 20, far 6 -> 12 (near 25 stays;
                    #   low near-cap 12 stays). Pure value change.
  terrainLod.test.ts# update mid/far expectations (BREAKING assertion fix).
  TerrainChunkManager.ts # heightTexels default 256 -> 384 (finer bilinear
                    #   data); makeCel keeps heightMap descriptor (~:112).
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `fix(materials): bilinear heightmap taps for smooth per-pixel normal`
   - `cel.ts` `HEIGHT_MAP` sampleH bilinear + `heightSmooth` opt;
     `cel.test.ts` source asserts.
   - Off-path bit-identical (4-tap nearest) when `heightSmooth` unset.
2. `fix(terrain): smooth rock/sand vertex-color blends`
   - `heightmap.ts` colorAt smoothstep + config windows; `heightmap.test.ts`.
3. `fix(terrain): densify mid/far segment tiers`
   - `terrainLod.ts` segmentTier mid 20 / far 12; `terrainLod.test.ts`.
4. `fix(terrain): raise heightmap texel density for finer bilinear data`
   - `TerrainChunkManager.ts` heightTexels 256 -> 384; build-cost note.
5. `docs: refine 021 plan + todo + troubleshooting`
   - mark 021 full plan in `docs/todo.md`; troubleshooting case (before/
     after: re-run the 12 m N.L step probe -> step intervals vanish / shrink
     below sub-pixel; no black screen; F3 tri count + heightmap build ms).

## Risks

- 16 taps/fragment on layer-1 terrain only: modest fill cost. Mitigation:
  `heightSmooth` opt lets a low tier fall back to 4-tap nearest; verify F3
  frame ms. Terrain is the only HEIGHT_MAP consumer (karts/props unaffected).
- Bilinear height can over-smooth sharp ridges (rock bands). Mitigation:
  texel 0.78 m already under-resolves sub-metre features; 384 (0.52 m) +
  the existing slope-based rock color keeps silhouettes readable. Verify.
- colorAt restructure shifts rock/sand zone edges slightly. Pure fn ->
  assert gradient monotonic + no step; road corridor (smoothstep already)
  unchanged. Visual verify crispness in review.
- heightTexels 256 -> 384: build cost ~1.5x heightAt calls (~0.15 s load),
  texture 384*384*16 B = 2.3 MB (was 1 MB). Bounded; verify load + memory.
- Denser mid/far colliders: parity invariant keeps collider verts == mesh
  verts (`src/AGENTS.md:74`), so far trimesh verts rise. Bounded (far only);
  keeping collider coarser would break the invariant -> rejected. Verify F3.
- Strict TS: new config fields defaulted in DEFAULT_TERRAIN_CONFIG.

## Acceptance

- [ ] `HEIGHT_MAP` normal is continuous: re-run the 12 m N.L step probe ->
      step intervals shrink toward sub-pixel (no 0.78 m staircase)
- [ ] Visible ~0.78 m square grid gone; terrain shades smoothly (1P + 2P)
- [x] `heightSmooth` opt compiles out clean off-path; `cel.test.ts` green
- [x] `colorAt` rock + sand weights rise smoothly across blend windows
      (no discrete per-vertex step); road corridor stays crisp
- [x] mid/far segment tiers 20 / 12; near stays 25
- [ ] heightAt/normalAt/waterLevel semantics unchanged; mesh/collider parity
      invariant holds; kart drives gap-free across chunk seams
- [ ] #26 diagonal/diamond band fold does NOT regress (per-pixel normal kept)
- [x] All touched files <= 600 lines; `typecheck && lint && test` + hook green
- [ ] Before/after step-probe numbers + no-black-screen in
      `docs/troubleshooting/`

## Defaults

- heightSmooth: on when `heightMap` set. Bilinear mix of 4 NearestFilter
  taps per neighbour; 16 taps/fragment. Off -> 4-tap nearest (today).
- heightTexels: 384 (was 256). texel 0.52 m, finer bilinear input.
- bandEdge: 0.12 unchanged (with a continuous normal the 3-band toon look
  keeps smooth edges; no dither needed).
- rock blend window: ~0.15 slope around `rockSlope`. sand blend window:
  ~1.0 m height around `sandLevel`. Moderate.
- segment tiers: near 25, mid 20, far 12 (was 25/12/6); low near-cap 12.
- heightSmooth surfaced as a user toggle in a new graphics submenu (main
  menu), persisted like audio settings; default on. The submenu shell is
  cross-cutting UI work (track separately); 021 owns the opt + the shader
  path, not the menu DOM.

## Verification (reproduce the proof)

Live probe (race cam): read `terrain` chunk material `uHeightMap` data,
replicate the shader's 4-tap central-difference normal along a 12 m world
line at 0.01 m, record `N.L` step positions. Before A': steps at 0.78 m
intervals. After A': steps vanish / fall below sub-pixel (continuous). See
`docs/troubleshooting/2026-06-27_terrain-invisible-heightmap-normal.md`
for the canvas `readPixels` + `g.renderer.slots[0].renderPass.camera`
probe pattern (render out-of-band aborts in `updateLightUniforms`; use the
heightmap-data path, not a re-render).

## Previous implementation

PR #26 (`03be333`) added the `HEIGHT_MAP` per-pixel normal to fix the diagonal
fold; this plan refines its tap filtering. Related: 001 (`cel.ts`), 003
(`heightmap.ts colorAt`), 019 (chunk grid + segmentTier + parity). The
analytic-in-shader "terrain shading v2" remains a deferred follow-on.

## Depends on

000 (harness). 001 (cel material). 003 (heightmap colorAt). 019 (chunk
grid + segmentTier). 026 / `03be333` (HEIGHT_MAP per-pixel normal; this
plan changes its tap filtering, does NOT revert it). Independent of
004-018/020.

## Decision log

2026-06-28: reviewed against the live build + the 3 reported visual issues.
Confirmed 021 = issue 1 only. Evaluated 3 smoothing methods:

- HalfFloat height + LinearFilter -> REJECTED. Troubleshooting doc
  2026-06-27 bans LinearFilter on the float height texture; float-linear is
  not core in WebGL2 and silently breaks on some devices.
- Baked RGBA8 world-normal texture (LinearFilter) -> DEFERRED to 023.
  Device-safe, but a 2nd architecture plus a fixed-world texture 023 reworks.
- A' manual bilinear in-shader, keep NearestFilter -> CHOSEN. Device-safe,
  lowest risk, keeps the #26 architecture, and the shader carries over to
  streaming unchanged.

Plan stays A' + D + B. heightSmooth opt becomes a user toggle in a graphics
submenu. Issues 2 (night wipe) + 3 (shadow pop) tracked under the
shadow-fade work, NOT here.

## Resolution (2026-06-28)

Implemented as the 4 code commits + this docs commit (5 of 5). File moved
`docs/backlog/open/` -> `docs/backlog/pending-review/` (status now tracked by
backlog dir, not `docs/todo.md` which `53d7b9f` dropped).

Shipped commits (top = latest):

- `613cbf9 fix(terrain): raise heightmap texel density for finer bilinear data`
- `6897c25 fix(terrain): densify mid/far segment tiers`
- `9fd82d0 fix(terrain): smooth rock/sand vertex-color blends`
- `707368c fix(materials): bilinear heightmap taps for smooth per-pixel normal`

Layer A' (PRIMARY, `707368c`, `src/materials/cel.ts`): `HEIGHT_MAP` block now
calls a `sampleH(vec2 worldXZ)` GLSL helper that bilinearly mixes 4
NearestFilter taps by the texel-fractional offset. Central-difference
neighbours read via `sampleH` -> height C0 -> normal piecewise-linear.
`heightSmooth` CelOpts flag (default on when `heightMap` set) toggles a
`HEIGHT_SMOOTH` define; off reverts to the exact 4-tap nearest path
(bit-identical, no `sampleH` in source). NearestFilter KEPT (float-linear not
core in WebGL2).

Layer D (SECONDARY, `9fd82d0`, `src/terrain/heightmap.ts`): `colorAt` hard
`if` thresholds -> smoothstep blends. rock weight =
`smoothstep(rockSlope +/- rockBlendSlope)`, sand weight =
`1 - smoothstep(sandLevel +/- sandBlendHeight)`. Road corridor stays a hard
early-return (crisp drivable surface, exact road linear preserved). New
`TerrainConfig.rockBlendSlope` + `sandBlendHeight` (defaults 0.15 / 1.0).

Layer B (TERTIARY, `6897c25`, `src/terrain/terrainLod.ts`): `segmentTier`
mid 12 -> 20, far 6 -> 12. near stays 25 (low near-cap 12 unchanged). Denser
mid/far quads keep vertex colour + normal interpolation sub-blocky at
distance.

Texel density (`613cbf9`, `src/terrain/TerrainChunkManager.ts`): default
`heightTexels` 256 -> 384 (texel 0.78 m -> 0.52 m at the 200 m world) so
bilinear has finer data to mix. `buildHeightTexture` untouched;
`heightMapDescriptor` reads the texel count off the texture image.

### Pending live verification (review checklist)

Below need a real browser/GPU. This env is jsdom-only (no WebGL), so they
were NOT run. Treat as TODO-for-review, not done:

- [ ] `HEIGHT_MAP` normal continuous: re-run the 12 m `N.L` step probe ->
      step intervals shrink toward sub-pixel (no 0.78 m staircase)
- [ ] Visible ~0.78 m square grid gone; terrain shades smoothly (1P + 2P)
- [ ] heightAt/normalAt/waterLevel semantics unchanged; mesh/collider parity
      invariant holds; kart drives gap-free across chunk seams
- [ ] #26 diagonal/diamond band fold does NOT regress (per-pixel normal kept)
- [ ] Before/after step-probe numbers + no-black-screen in
      `docs/troubleshooting/`

Probe pattern: see
`docs/troubleshooting/2026-06-28_021-terrain-normal-quantisation.md`
("Pending live verification" section) and the 2026-06-27 doc's
`readPixels` + heightmap-data path.
