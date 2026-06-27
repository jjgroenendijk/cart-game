# 021 Terrain shade-quantisation (heightmap-texel normal)

Status: open (full plan; ready for execution)

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
- Touching the cel look of karts/props (HEIGHT_MAP is terrain-only).
- Changing `heightAt`/collider semantics or the mesh/collider parity
  invariant (`src/AGENTS.md:74`).

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
- [ ] `heightSmooth` opt compiles out clean off-path; `cel.test.ts` green
- [ ] `colorAt` rock + sand weights rise smoothly across blend windows
      (no discrete per-vertex step); road corridor stays crisp
- [ ] mid/far segment tiers 20 / 12; near stays 25
- [ ] heightAt/normalAt/waterLevel semantics unchanged; mesh/collider parity
      invariant holds; kart drives gap-free across chunk seams
- [ ] #26 diagonal/diamond band fold does NOT regress (per-pixel normal kept)
- [ ] All touched files <= 600 lines; `typecheck && lint && test` + hook green
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
