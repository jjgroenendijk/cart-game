# 2026-06-28 Terrain square shade grid (heightmap texel-quantised normal)

## TL;DR

Symptom: visible grid of ~0.78 m squares on the terrain, each cell a slightly
different shade than its neighbour. Root cause: the `HEIGHT_MAP` per-pixel
normal finite-differences 4 NearestFilter taps, so the central-difference
normal is piecewise-constant per texel and `dot(N,L)` steps every texel ->
one cel shade per ~0.78 m cell. Fix: bilinearly interpolate the taps in-shader
via a `sampleH` helper (NearestFilter kept); plus smooth rock/sand blends,
denser mid/far tiers, finer texel density. See
`docs/backlog/pending-review/021_terrain-normal-quantisation.md`.

## Symptom

Post-#26 the terrain reads rasterised: ~0.78 m square cells of constant shade,
stepped road/grass/sand boundaries, blocky light bands, stippled shadows. The
cell size == the heightmap texel size (200 m world / 256 texels = 0.78125 m).

Distinct from the diagonal/diamond cel-band fold #26 already killed (`03be333`,
per-pixel heightmap normal; see
`docs/troubleshooting/2026-06-27_terrain-invisible-heightmap-normal.md`). #26
was a triangulation-aligned zig-zag from per-vertex normal interpolation; this
is a NEW texel-aligned grid from per-pixel normal quantisation. Same
architecture (#26 `HEIGHT_MAP` path), different rasterisation artefact.

## Root cause

`CelMaterial` derives N per fragment from a baked height texture (`HEIGHT_MAP`,
`src/materials/cel.ts`). That texture is a float `DataTexture`, NearestFilter,
finite-differenced at a 1-texel offset (`src/terrain/TerrainChunkManager.ts`).

Nearest sampling makes each of the 4 neighbour taps (hL/hR/hD/hU)
piecewise-constant: every fragment inside one ~0.78 m texel cell reads the same
4 tap values -> the central-difference normal `Nworld = normalize(vec3(-dhx,
1, -dhz))` is constant within that cell and steps at the cell border. `N.L`
therefore steps every 0.78 m, and the cel shade (`base * sun * band + base *
amb`, bandEdge 0.12 smoothstep across 3 bands) renders one slightly different
shade per ~0.78 m cell -> the grid of squares.

Vertex colors (`colorAt`) and mesh quad size are NOT the primary driver: shade
varies per cell even on uniform-colour regions because N varies.

## Fix (layered)

Four commits (top = latest):

- `707368c` `fix(materials): bilinear heightmap taps for smooth per-pixel
normal` -- PRIMARY. `src/materials/cel.ts` `HEIGHT_MAP` block: a
  `sampleH(vec2 worldXZ)` GLSL helper bilinearly mixes 4 NearestFilter taps
  by the texel-fractional offset; central-difference neighbours read via it.
- `9fd82d0` `fix(terrain): smooth rock/sand vertex-color blends` --
  `src/terrain/heightmap.ts`: `colorAt` hard `if` thresholds -> smoothstep
  blends (rock over ~0.15 slope, sand over ~1.0 m). Road corridor stays crisp
  (hard early-return).
- `6897c25` `fix(terrain): densify mid/far segment tiers` --
  `src/terrain/terrainLod.ts`: segmentTier mid 12 -> 20, far 6 -> 12. Denser
  distance quads; near 25 stays.
- `613cbf9` `fix(terrain): raise heightmap texel density for finer bilinear
data` -- `src/terrain/TerrainChunkManager.ts`: default `heightTexels`
  256 -> 384 (texel 0.52 m). Finer bilinear input; sharper ridges.

NearestFilter is KEPT. float-linear filtering is not guaranteed core in
WebGL2 and may silently break (`2026-06-27_terrain-invisible-heightmap-
normal.md`); manual bilinear is the device-safe equivalent. The `heightSmooth`
CelOpts flag (default on when `heightMap` set) gates a `HEIGHT_SMOOTH` define;
off -> the exact 4-tap nearest path, bit-identical to pre-fix (no `sampleH` in
source). The fragment shader is built per-instance so the off-path source
omits the bilinear helper entirely.

## Why this is continuous

Bilinear height -> C0 height -> central-difference normal piecewise-LINEAR (no
step at texel borders) -> `N.L` smooth -> cel bands smooth. Bilinear never
introduces a discontinuity, so the normal cannot staircase at texel edges the
way nearest taps did. Texel 256 -> 384 gives the bilinear mix finer data to
sample (texel ~0.78 m -> ~0.52 m at the 200 m world), so sub-metre features
the chunk mesh resolves now influence the per-pixel normal instead of being
flattened by coarse mixing.

## Non-regression

- HEIGHT_MAP architecture kept, NOT reverted. Only the tap filtering changed;
  `#26` diagonal/diamond fold does not return (per-pixel normal preserved).
- `normalMatrix` fragment decl kept (`2026-06-27` compile fix stands).
- mesh/collider parity invariant held: collider verts == mesh verts by
  construction (denser mid/far tiers raise both together).
- heightAt/normalAt/waterLevel semantics unchanged.
- Road corridor stays crisp: rock/sand blends skip the hard road band
  (`colorAt` early-returns pure road inside `trackHalfWidth`).
- Off-path (`heightSmooth` unset) is bit-identical to the pre-fix 4-tap nearest
  source.

## Pending live verification (review checklist)

[INFO] This environment is jsdom-only (no GPU / no WebGL). The live probe and
visual checks below were NOT run. They are TODO-for-review, not done.

```bash
npm run dev            # start vite (:5173)
```

In a real browser (DevTools console), re-run the 12 m `N.L` step probe via the
`readPixels` + heightmap-data path documented in
`docs/troubleshooting/2026-06-27_terrain-invisible-heightmap-normal.md`
("After fix -> verify" + "Resolution" sections: `g.renderer.slots[0]` camera
render out-of-band aborts in `updateLightUniforms`, so use the heightmap-data
path, not a re-render). Replicate the shader's central-difference normal along
a 12 m world line at 0.01 m resolution off the live `uHeightMap` data.

Expect:

- step intervals shrink toward sub-pixel (no 0.78 m staircase).
- no `THREE.WebGLProgram: Shader Error`; no black screen.
- F3 tri count + heightmap build ms (record both; texel 384 build cost ~1.5x
  the old 256 path, bounded + amortised at construction).

Record before/after step-probe numbers + no-black-screen confirmation back
into this doc once a reviewer runs them.

See `docs/backlog/pending-review/021_terrain-normal-quantisation.md`.
