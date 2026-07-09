# 069 Terrain surface detail: procedural grain + micro-normal

Status: pending-review (implemented; see commits d991949..a3b6f2c)

## Context

Near-terrain shades clean but reads as flat plastic up close: colour is
the per-vertex biome splat (road/grass/rock/sand via `colorAt`) and the
surface normal is the per-fragment heightmap central-difference
(`materials/cel.ts` HEIGHT_MAP path). Between texels the albedo is a
smooth vertex-colour lerp and the normal is smooth, so grass/dirt/rock
have zero small-scale texture — the eye reads a matte sheet.

A live demo (CPPN-terrain artifact, this branch's R&D) showed the fix:
layer a cheap value-noise fbm over the surface at two jobs — mottle the
albedo, and perturb the shading normal with the noise gradient (a micro
bump). Result is convincing ground texture (grain, patchiness, relief
sparkle under the cel light) with no textures, no assets, no ML runtime.
The demo's macro shape came from a CPPN; that is NOT this task — the game
already owns its heightfield (spline track + heightmap + trimesh
collider). This task is only the fine SURFACE DETAIL, and it is pure
procedural fbm keyed on world (x,z). Code-native, no committed media, no
model files.

Load-bearing observation: the near material already carries everything
needed. `materialNear = makeCel({ vertexColors, heightMap, cel:false,
wetness })` (`terrain/TerrainChunkManager.ts:148`). Its fragment already
has `varying vec2 vWorldXZ`, computes `vec3 Nworld` before mapping to
view via `normalMatrix`, and builds `base = uColor * vColor` in LINEAR.
Detail folds in at those two points behind a define — zero new passes,
zero geometry change, zero collider change. Karts must not feel it: this
is shading only; `heightAt` and the trimesh are untouched, so the "mesh
verts and collider verts identical by construction" invariant holds and
suspension raycasts are unchanged.

## Goal

Near terrain gains fine, code-native surface texture — fbm albedo mottle
plus a micro-normal bump — folded into the existing cel fragment behind
a `SURFACE_DETAIL` define, tier-gated, deterministic from world (x,z),
defaults tuned so grass/rock/sand read textured up close and fade into
fog at distance. Off-path stays byte-identical to the pre-069 shader.

## Non-goals

- No CPPN / neural model, no weight files. The macro heightfield stays
  the existing spline+heightmap source; a CPPN terrain GENERATOR is a
  separate concept (concept stub territory), not this.
- No heightAt / collider / physics change. Detail is a shading term
  only; karts feel the same ground. No new mesh verts.
- No far-material detail in v1. `materialFar` (no heightMap, vertex
  normals, distant + fogged) stays as-is; a faded far variant is a
  follow-up if the near look lands.
- No per-biome roughness authoring in v1 — one tuned default set. A
  biome-scaled strength hook (via the 025 cascade) is a noted follow-up.
- No user-facing settings row; quality-tier gating only.

## Architecture (change)

```text
src/materials/
  terrainDetail.ts   # NEW PURE (jsdom-tested): the detail algorithm as
                     #   (a) a JS reference impl locking the math -
                     #     hash2(vec2), vnoise(vec2), fbm(vec2, octaves)
                     #     - so a unit test pins determinism + range,
                     #   (b) exported GLSL source strings:
                     #     DETAIL_NOISE_FN (hash/vnoise/fbm) and the two
                     #     apply snippets (albedo mottle, normal bump),
                     #   (c) DETAIL_DEFAULTS { strength, scale, bump,
                     #     octaves } + a QualityTier -> params map helper
                     #     (low -> disabled).
                     #   Mirrors the postGrade.ts pattern (pure math +
                     #   shader source asserted by tests).
  cel.ts             # CelOpts gains `surfaceDetail?: boolean`. When set
                     #   (only meaningful with heightMap): add define
                     #   SURFACE_DETAIL + uniforms uDetailStrength,
                     #   uDetailScale, uDetailBump (+ octaves baked as a
                     #   compile constant via the snippet). Fragment,
                     #   under #ifdef SURFACE_DETAIL, gated inside the
                     #   existing #ifdef HEIGHT_MAP block:
                     #     - after Nworld: g = fbm gradient at
                     #       vWorldXZ*uDetailScale; Nworld = normalize(
                     #       Nworld + vec3(-g.x,0,-g.y)*uDetailBump);
                     #     - after `base *= vColor`: base *= 1.0 +
                     #       uDetailStrength*(fbm(...)-0.5).
                     #   All multiplies in LINEAR (base is linear) so the
                     #   ACES+sRGB-once invariant is untouched. Off ->
                     #   no define, no uniforms, source byte-identical.
                     #   Runtime toggle setter (like flatShading) for
                     #   tier change -> needsUpdate recompile.
src/terrain/
  TerrainChunkManager.ts # materialNear: pass surfaceDetail + write the
                     #   tier's detail uniforms. materialFar unchanged.
                     #   setQuality path (or construct-time tier) selects
                     #   params; runtime tier change flips the define +
                     #   reuploads uniforms on materialNear only.
src/core/
  quality.ts         # QualityKnobs gains terrainDetail params (or a
                     #   nullable block): low = disabled (define off, bit-
                     #   identical), med = 2 octaves / modest strength,
                     #   high = 3 octaves / full strength. Pure + tested.
```

## Look targets

- Albedo mottle: +/- ~8-12% linear brightness variation at high tier,
  fbm scale ~0.9 world-units base octave (finer than the 384-texel
  heightmap grid over worldSize so it never beats against the texel
  shade cells / HEIGHT_SMOOTH knots). Reads as soil/grass grain, not
  noise static.
- Micro bump: normal perturbation subtle enough that cel/lambert picks
  up a faint sparkle on slopes but silhouettes and the macro shading
  stay driven by the real heightmap normal. Bump strength is the first
  thing to back off if it reads busy.
- Distance: detail is strongest near camera and dissolves into the
  existing fog/aerial band before the near/far material boundary, so
  the far chunks (no detail) never show a hard seam.
- Tiers: low = identical to pre-069 (off). med = present but calmer
  (2 octaves). high = full (3 octaves + bump).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(materials): pure terrain-detail noise + glsl source`
   - `terrainDetail.ts` + tests: hash/vnoise/fbm determinism (fixed
     inputs -> fixed outputs), fbm range within [0,1], octave
     monotonicity, DETAIL_DEFAULTS sane, tier->params map (low
     disabled). Exported GLSL strings non-empty + contain the fn names
     the shader test will assert.
2. `feat(materials): SURFACE_DETAIL branch in CelMaterial`
   - cel.ts define + uniforms + fragment injection (neutral, gated).
     Tests: with surfaceDetail on, fragment source contains the noise
     fn + both apply sites + the 3 uniforms; with it off, source is
     byte-identical to current (snapshot/equality) and no uDetail\*
     uniforms exist; runtime toggle sets needsUpdate; LINEAR path
     unchanged (base multiply, not post-tonemap).
3. `feat(terrain): near-terrain detail wired to quality tiers`
   - TerrainChunkManager builds materialNear with surfaceDetail +
     tier params; setQuality flips define + reuploads on tier change;
     materialFar untouched. quality.ts knobs + tests (low disabled;
     med/high params; pure mapping). Tests assert materialNear carries
     the define at med/high and not at low, and that heightAt/collider
     construction is unchanged (no geometry diff).
4. `docs: AGENTS refresh + backlog move`
   - `src/AGENTS.md` cel-material + terrain notes (surface detail is
     shading-only, near material, tier-gated, no collider impact);
     move 069 to pending-review.

## Risks

- Cost: fbm + gradient (albedo tap + ~2 taps for the bump gradient,
  x octaves) runs per near-terrain fragment. Mitigation: tier-gated
  (low off), octave count is a compile constant so each tier compiles
  the minimal loop, near region only. F3 EWMA check on low+med incl.
  2P split-screen.
- Texel beating: detail scale near the heightmap texel size would moire
  against the HEIGHT_SMOOTH bilinear grid. Mitigation: base octave
  chosen well finer than texel-world; verify on a flat plateau (worst
  case for grid artifacts).
- Busy/noisy look: over-strong bump reads as sandpaper. Mitigation:
  conservative defaults, bump is the first dial down; commit-3 visual
  acceptance on all four biomes.
- Off-path drift: any accidental change to the no-detail shader source
  breaks the "byte-identical when off" contract other cel tests rely
  on. Mitigation: commit-2 equality test guards it; all new source is
  strictly inside `#ifdef SURFACE_DETAIL`.
- 600-line cap: cel.ts is 401 lines; the detail snippet + branch adds
  ~60-90. Stays under, but if tight, the GLSL lives in terrainDetail.ts
  strings (already the plan) so cel.ts only gains the define/uniforms +
  interpolation, not the noise body.
- Determinism: detail must be a pure fn of world (x,z) (no time, no
  per-frame state) so stills + replays stay stable. Enforced by
  construction (no uTime in the detail path).

## Acceptance

- [ ] Up-close near terrain shows fine grain + faint slope sparkle on
      grass/rock/sand across all four biomes; distance dissolves it
      into fog with no seam at the near/far material boundary.
- [ ] Low tier renders byte-for-byte the pre-069 look (define off);
      `surfaceDetail:false` fragment source equals current (test).
- [ ] Kart physics unchanged: heightAt, trimesh collider, suspension
      raycasts identical (no geometry diff; shading-only).
- [ ] LINEAR/ACES invariant intact (mottle multiplies linear base
      pre-OutputPass); rim/specular/wetness/shadow paths unaffected.
- [ ] med/high frame time within budget on F3 (incl. 2P split-screen);
      low tier frame time unchanged vs pre-069.
- [ ] All files <= 600 lines, <= 100 chars; `npm run verify` + hooks
      green.

## Verification

- Drive near-camera passes on temperate/desert/alpine/tundra; A/B by
  toggling `surfaceDetail` (or zeroing uDetailStrength/Bump in devtools)
  to confirm the identity path and calibrate subtlety.
- Flat-plateau shot to rule out texel/grid moire.
- F3 sweep low/med/high, 1P and 2P; confirm low == pre-069 and no new
  render targets / material recompiles per frame (only on tier change).
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reuses the near material's HEIGHT_MAP path + vWorldXZ
(`cel.ts`), quality tiers (011), biome colorAt splat (025, unaffected).
Composes with wetness (054, multiplies the same linear base) and 064
post-grade (independent pipeline stage). Follow-ups unlocked, not
included: faded far-material detail; per-biome roughness via the 025
cascade; and — separately — a CPPN/procedural macro terrain GENERATOR
(own concept), which this task is deliberately NOT.
