# 2026-06-27 Terrain invisible (heightmap per-pixel normal path)

## TL;DR

Terrain invisible after adding per-pixel heightmap normal path to `CelMaterial`.
Fragment shader fails to compile:

```text
ERROR: 0:376: 'normalMatrix' : undeclared identifier
  376:     N = normalize(normalMatrix * Nworld);
```

Bad program -> nothing renders -> terrain gone (rest of scene fine: sky,
karts, props still draw).

## Root cause

three.js auto-injects builtin uniforms via a shader PREFIX. Vertex prefix
includes `uniform mat3 normalMatrix;`; FRAGMENT prefix does NOT. The
HEIGHT_MAP path in `src/materials/cel.ts` fragment uses `normalMatrix` to
map the world-space heightmap normal -> view space. Fragment never declares
it -> compile error.

The FLAT path before this never touched `normalMatrix` in fragment (it used
`dFdx(vViewPos)`), so the gap was never hit. HEIGHT_MAP introduced the
first fragment use of `normalMatrix`.

## Fix (apply one)

### Option A (recommended, 1 line)

Declare the uniform in the fragment's HEIGHT_MAP block. three binds
`normalMatrix` once per program (it is in the per-program uniform set the
renderer uploads every frame), and the vertex already declares it, so a
fragment declaration links to the same uniform. Safe: three's fragment
prefix does NOT declare `normalMatrix`, so no redefinition.

In `src/materials/cel.ts` CEL_FRAG, inside the existing
`#ifdef HEIGHT_MAP` uniform block (~line 120-126), add:

```glsl
uniform mat3 normalMatrix;
```

Right next to the existing `uniform sampler2D uHeightMap;` etc.

### Option B (world-space lighting, no normalMatrix)

Compute lighting in WORLD space for HEIGHT_MAP only. Use `uSunDirWorld`
(already in `materials/lightUniforms.ts`), `cameraPosition` (auto in
fragment), and a 3D `varying vec3 vWorldPos;`. Then
`NdL = dot(Nworld, normalize(uSunDirWorld))`,
`V = normalize(cameraPosition - vWorldPos)`. Bigger change; only pick if
Option A somehow does not bind (it will).

## After fix -> verify

```bash
npm run dev            # start vite
```

Open http://localhost:5173/, open DevTools console. Race must start, drive
forward (hold W). Console must show ONLY:

- `[warn] using deprecated parameters for the initialization function` (Rapier, benign)
- favicon 404 (benign)

NO `THREE.WebGLProgram: Shader Error`. If a shader error appears, the
fragment (or vertex) still has an undeclared symbol -> read the line in the
error, declare it or remove it.

Probe the live renderer to confirm terrain material is the heightmap path:

```js
// sun (castShadow true by day)
window.__game.renderer.scene.children.find((c) => c.isDirectionalLight);
// Terrain chunk material:
window.__game.terrain.group.children[0].material.defines.HEIGHT_MAP; // ""
```

See `docs/troubleshooting/2026-06-20_visual-verification-fallback.md` for
the no-image-input verify approach (canvas pixel sampling) if vision tools
are unavailable.

## What this change is for (do NOT revert)

Symptom this fixes: sharp DIAGONAL / DIAMOND cel-band pattern aligned with
the terrain triangle grid. Cause: cel `floor(NdL*uBands)` quantizes
`dot(N,L)` where `N` is the per-vertex analytic normal LINEARLY interpolated
per triangle. That interpolation folds across each quad's diagonal (C1
kink); the quantizer turns the kink into a visible zig-zag. Not a geometry
gap, not a winding bug, not Z-fighting.

The heightmap path makes N per-pixel from a baked height texture, so it is
independent of triangulation -> no diagonal fold -> cel bands stay smooth.
This is the correct fix; only the `normalMatrix` compile bug blocks it.

## HEIGHT_MAP implementation map (current, uncommitted)

All in working tree, NOT committed yet. Files touched:

- `src/materials/cel.ts`
  - `CelOpts.heightMap?: HeightMapField` + `HeightMapField` interface
    ({texture, origin:[x,z], size, texels}).
  - `defines["HEIGHT_MAP"]=""` when heightMap set.
  - uniforms: `uHeightMap`, `uHeightOrigin` (Vector2),
    `uHeightSize` (float), `uHeightTexelWorld` (= size/texels).
  - vertex: `varying vec2 vWorldXZ;` (HEIGHT_MAP), set from
    `worldPosition.xz`. `worldPosition` now computed when
    `defined(HEIGHT_MAP) || NUM_DIR_LIGHT_SHADOWS>0`.
  - fragment: HEIGHT_MAP branch computes `hUV=(vWorldXZ-uHeightOrigin)/uHeightSize`,
    4 neighbour taps at +-1 texel, central difference ->
    `Nworld=normalize(vec3(-dhx,1,-dhz))`, then (the broken line)
    `N=normalize(normalMatrix*Nworld)`. HEIGHT_MAP takes precedence over
    FLAT and the default `vViewNormal` path.
  - rim/specular/shadow code unchanged; they consume the computed `N`.

- `src/terrain/TerrainChunkManager.ts`
  - `TerrainChunkManagerOptions.heightTexels?: number` (default 256).
  - `buildHeightTexture(src, worldSize, texels)` -> float RGBA `DataTexture`,
    NearestFilter, no mipmaps, ClampToEdgeWrapping. Texel (i,j) centre at
    world (origin+(i+0.5)/N*size, origin+(j+0.5)/N*size); height in .r.
  - ctor builds texture once, passes descriptor to `makeCel`.
  - `dispose()` calls `this.heightMap.dispose()`.
  - collider (trimesh) path UNCHANGED -> physics unaffected.

- Tests added: `src/materials/cel.test.ts` (HEIGHT_MAP define + uniforms +
  source asserts), `src/terrain/TerrainChunkManager.test.ts` (material has
  HEIGHT_MAP, texture is 16x16 DataTexture, texel world size = 40/16).

## Data flow

```text
TerrainChunkManager ctor
  -> buildHeightTexture samples src.heightAt on NxN world grid -> DataTexture
  -> makeCel({vertexColors:true, heightMap:{texture,origin,size,texels}})
       -> CelMaterial, defines.HEIGHT_MAP, uHeight* uniforms
  -> one shared material renders every chunk mesh (layer 1)

Per frame, fragment:
  vWorldXZ (world x,z of fragment) -> hUV -> 4 height taps -> Nworld
  -> N (view) -> cel band(NdL) -> shadow mask -> rim/spec -> LINEAR out
  -> OutputPass (ACES + sRGB)
```

## Gotchas / constraints

- Use RGBA FloatType for the height texture, NOT RedFormat. RedFormat R32F
  works in WebGL2 but has edge cases; RGBA is safe. Memory at N=256 over
  200 m world = 256*256*16 B = 1 MB. Build cost ~65k heightAt calls
  (~0.1 s) at load.
- NearestFilter on the height texture (the shader finite-differences
  neighbours itself). Do NOT use LinearFilter: float-linear filtering is
  not guaranteed core in WebGL2 and may silently break.
- Texture spans the FULL world (default 200 m, origin = -worldSize/2).
  Chunks live in [-100,100]. UV = (vWorldXZ - origin)/size -> [0,1].
  ClampToEdge handles the +-1-texel neighbour read at world edges.
- normalAt on the CPU (chunkBuilder `normals` attribute) is STILL emitted
  and still the chunk-border seam fix; it is unused by the HEIGHT_MAP
  fragment but kept for the collider-adjacent code and tests. Do not delete
  it.
- The terrain material still has `lights:true` + shadow chunks (commit
  fix(render): wire real directional shadows). HEIGHT_MAP N feeds the same
  rim/spec/shadow path. Do not regress shadows.

## Git state

Branch: `fix/steering-rocks-seams-shadows` (pushed, PR #25 on
github.com/jjgroenendijk/cart-game). Committed on branch (all green, 901
tests):

1. `fix(input): correct reversed steering sign`
2. `fix(props): seat rocks on terrain and size collider to the visible rock`
3. `fix(terrain): author world-consistent chunk normals to remove seam lines`
4. `fix(render): smooth cel band edges and start the session in daytime`
5. `fix(render): wire real directional shadows into CelMaterial`

UNCOMMITTED (working tree only, the broken heightmap change):

- `src/materials/cel.ts`, `src/materials/cel.test.ts`
- `src/terrain/TerrainChunkManager.ts`, `src/terrain/TerrainChunkManager.test.ts`

`docs/backlog/concept/` is untracked and UNRELATED (pre-existing stubs) -
do not commit it.

Plan after fix compiles + verifies: commit heightmap change as
`fix(terrain): per-pixel heightmap normal to kill diagonal cel banding`,
push to PR #25.

## Verify gates before commit

```bash
npm run typecheck
npm run test            # full, expect 901 + new heightmap tests
npm run lint:eslint
npm run dev             # browser: no shader error, terrain visible, drive
```

Pre-commit hook runs format -> lint -> typecheck -> test -> secrets; all
must pass. Governance hook enforces AGENTS.md structure (size, Mermaid
diagram, CLAUDE.md symlink) and top-level dir coverage.

## Resolution (2026-06-27)

Applied Option A. In `src/materials/cel.ts` CEL_FRAG HEIGHT_MAP uniform
block, added `uniform mat3 normalMatrix;` (fragment-only; three's fragment
prefix omits it -> no redefinition). Links to the same per-program uniform
the vertex already declares. One real line + an explanatory comment.

Gates (all green):

- typecheck clean; `lint:eslint` clean.
- full suite 903 pass (901 committed baseline + heightmap tests; added a
  `uniform mat3 normalMatrix;` fragment-source guard to cel.test.ts so the
  exact regression can't silently return).
- browser (vite :5173): console shows ONLY the benign Rapier deprecation
  warn; NO `THREE.WebGLProgram: Shader Error`.
- scene traverse: 64 chunk meshes on HEIGHT_MAP + vertexColors (8 wall
  meshes on the non-heightmap material, as expected).
- canvas pixel sample (`gl.readPixels` synchronously right after
  `r.render(menuCamera)`, since `preserveDrawingBuffer:false` clears the
  buffer on composite so post-frame `drawImage` reads all-zero):
  skyTop `[23,8,14]`, ground L/C/R `[66,59,21]` / `[79,78,68]` /
  `[68,36,23]`. Non-black, sky != ground, ground varies across the bottom
  band (grass/sand vertex colors) -> terrain renders. Before fix: shader
  failed to compile -> terrain drew nothing.

Lesson: a GLSL template literal that embeds backticks terminates the JS
template early -> oxc/tsc parse error (`',' expected`). First attempt hit
this; keep shader comments backtick-free.

Status: uncommitted in working tree; ready to commit as
`fix(terrain): per-pixel heightmap normal to kill diagonal cel banding`
(push to PR #25). Commit NOT made yet (awaiting explicit go-ahead).
