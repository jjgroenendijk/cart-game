# 062 Water visual upgrade: shore foam, depth tint, sun glints

Status: pending-review (commits 1-3 landed; commit 4 docs)

## Context

CelWater (`materials/celWater.ts`) is the least-developed cel surface in
the game: two directional sine waves displace the plane, the fragment
snaps a facing-ratio (N dot V) into bands and mixes `uDeep -> uShallow`
by that same facing term. Consequences:

- Water color has no relation to actual depth. A 30 cm shore shelf and a
  10 m lake bed read identically; the deep/shallow mix changes with the
  camera angle, not the world.
- Shorelines are a hard polygon edge: terrain dives under a flat plane
  with no foam/contact band. Every stylized-water reference (and every
  cel racer) sells water at the shoreline first.
- The sun does not exist on the water: no glint/sparkle band, so at dawn
  and dusk (042 makes those reachable in race config) the most dramatic
  sky has a dead flat floor under it.

The missing ingredient already exists: `TerrainChunkManager` bakes a
world height texture (`buildHeightTexture(src, worldSize, 384 texels)`,
`terrain/TerrainChunkManager.ts:147`) and hands it to cel terrain as a
`HeightMapField` descriptor {texture, origin, size, texels}
(`materials/cel.ts`). Water depth below the plane is
`uWaterY - heightSample` — one texture read in the water fragment,
zero new bakes, zero CPU work. The two ripple sines are analytic, so a
world-space ripple normal for glints is a closed-form derivative, not a
texture.

Constraints: LINEAR output + OutputPass ACES/sRGB once; fog uniforms
pushed by the renderer (`USE_FOG` block already handled); biome
`waterColor -> uTint` with white = identity (025) must keep meaning
"biome tints the final water color"; Water follows humansMidpoint
(`environment/Water.ts`, 200 m plane, matrix updated manually) so all
shading must be world-space, not object-space.

## Goal

Water reads as water: a banded shore-foam line hugs every coastline and
breathes with time, color deepens with true depth, and a cel-quantized
sun glint band tracks the sun. All procedural in the existing shader,
one added texture sample, defaults on for every biome.

## Non-goals

- No reflections, refraction, or screen-space anything (054 already
  scopes those out; this stays a single forward shader).
- No geometry change: same plane, same two-sine displacement, no shore
  skirt meshes.
- No gameplay/buoyancy coupling (048 owns buoyancy fidelity).
- No new bake: reuse the 384-texel height map as-is; texel-resolution
  artifacts are accepted and noted (see Risks + 021).

## Architecture (change)

```text
src/materials/
  waterShading.ts   # NEW PURE: closed-form helpers mirrored in GLSL,
                    #   jsdom-tested: depthBelow(waterY, h);
                    #   foamMask(depth, foamWidth, t) -> banded 0..1
                    #   (2 steps, edge animated by a slow sine of
                    #   shore-distance phase + time, cel not smooth);
                    #   depthTintMix(depth, deepDepth) -> uDeep/uShallow
                    #   mix factor (replaces facing for the mix);
                    #   rippleNormal(x, z, t, amp) -> analytic d/dx,
                    #   d/dz of the two vertex sines (same constants);
                    #   glintBand(N, sunDir, viewDir, bands).
  celWater.ts       # frag rewrite: adds uHeightMap/uHeightOrigin/
                    #   uHeightSize (HeightMapField, same uniform trio
                    #   idiom as cel.ts), uWaterY, uFoamColor,
                    #   uFoamWidth, uDeepDepth, uGlintIntensity.
                    #   vert passes vWorldXZ (worldPos from modelMatrix
                    #   so the follow-focus plane samples correctly).
                    #   Pipeline: depth tint -> existing band snap ->
                    #   glint add (LINEAR, sun-colored, 2 bands) ->
                    #   foam lerp toward uFoamColor -> uTint -> fog.
                    #   Out-of-field guard: if sample XZ outside the
                    #   baked bounds, fall back to today's facing mix,
                    #   foam = 0, glint stays (streaming worlds degrade
                    #   gracefully past the baked region).
src/terrain/
  Terrain.ts        # expose heightMapField() (getter forwarding from
                    #   TerrainChunkManager's private descriptor; same
                    #   move 053 makes for colorAt).
src/environment/
  Water.ts          # accepts optional heightMap descriptor + waterY in
                    #   opts; forwards uniforms. No descriptor = legacy
                    #   look (tests/jsdom keep working with no texture).
  Environment.ts    # plumbs terrain.heightMapField() into Water build.
src/core/
  quality.ts        # low tier: uGlintIntensity = 0 (skips the ripple-
                    #   normal math via uniform, no shader variant).
```

## Look targets (cel discipline)

- Foam: 2 hard bands (solid near-white at depth < ~0.4 m, half-tone to
  ~1.2 m), edge wobbles slowly (~0.15 Hz) so shorelines breathe; foam
  is applied before uTint so biome-tinted water tints its foam too.
- Depth tint: uShallow within ~1.5 m falling to uDeep by ~6 m; facing
  ratio keeps only the fresnel rim job it already does.
- Glint: a quantized 2-step specular streak toward the sun, sun-colored
  from lightUniforms, intensity scaled by dayCycle sun intensity so
  night water goes dark, dawn/dusk gets the long orange streak.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(materials): pure water shading math (foam, depth, glints)`
   - `waterShading.ts` + tests: foam band edges, depth mix pinning
     (0 -> shallow, >= deepDepth -> deep), ripple normal matches
     numeric finite difference of the vertex sines, glint band count.
2. `feat(materials): depth-aware cel water with shore foam + glints`
   - `celWater.ts` rewrite + `Terrain.heightMapField()` + Water/
     Environment plumbing. Tests: shader source contains the mirrored
     expressions, uniform defaults, no-descriptor fallback path, biome
     uTint still multiplies last (025 parity semantics).
3. `feat(core): low-tier glint knob`
   - quality.ts wiring + test; F3 check that the extra texture sample
     is invisible in frame time on low.
4. `docs: AGENTS refresh + backlog move`
   - `src/AGENTS.md` materials note; move 062 to pending-review; note
     in 052 that a shoreline still (`?scene=`) now covers water pixels.

## Risks

- 384-texel height map -> foam edge quantisation on large worlds (the
  same artifact class as open task 021). Mitigation: bilinear sampling
  (LinearFilter clone or manual 4-tap if the baked texture must stay
  NearestFilter for cel terrain normals — decide at impl; a manual
  bilinear in the water frag avoids touching the terrain's texture
  filter) + the animated foam edge visually eats residual stair-steps.
- Water plane follows focus beyond the baked field (023 streaming):
  guarded fallback above; visible as foam fading out past the authored
  region — acceptable, matches terrain's own out-of-bounds softening.
- Shader cost: +1 texture sample + trig for ripple normals per fragment
  over a large screen area. Mitigation: glint math behind a uniform
  (low tier zeroes it), foam/depth is cheap; F3 EWMA acceptance on low.
- 025 parity: temperate default changes visually (foam appears). That
  is the point of the task; biome-vs-temperate parity (undefined biome
  fields = identity) is untouched because all changes are biome-blind.
- Sines in vert vs frag must share constants: mirrored from one
  exported constant table in waterShading.ts, asserted by tests.

## Acceptance

- [ ] Shore foam band visible on every water body, 2 cel steps, edge
      animates; no foam over deep water or on land.
- [ ] Water color tracks depth (shelf vs lake bed differ from the same
      camera angle); fresnel rim unchanged.
- [ ] Sun glint streak points at the sun, quantized, sun-colored;
      fades to zero at night; long streak at dawn/dusk (042 config).
- [ ] Outside the baked height field the shader falls back to the
      legacy facing look with no seam pop at the boundary crossing.
- [ ] Biome waterColor tint still applies (desert/alpine visibly
      tinted, temperate white identity semantics intact).
- [ ] Low tier: glints off, foam on, no measurable frame-time change
      (F3 EWMA on the reference low-tier device).
- [ ] All files <= 600 lines; `npm run verify` + hooks green.

## Verification

- F3 drive to alpine lakes + temperate ponds: foam line, depth tint,
  glint tracking across a full 042 time-of-day sweep.
- Drive past the authored world edge (023 streaming) watching the
  shoreline fallback boundary.
- 2P split-screen over water on low tier; watch fps + draw calls.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reads 023 (baked HeightMapField + streaming bounds), 025
(uTint semantics), 042 (time-of-day sweep for glint verify). Composes
with 052 (shoreline still) and 054 (dynamic weather dims sky; glint
already scales with dayCycle sun intensity, so storm dimming composes
for free if 054 lands its sky-dim channel). Links: 021 (texel
quantisation), 048 (buoyancy visuals stay separate).
