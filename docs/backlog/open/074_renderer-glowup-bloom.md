# 074 Renderer glow-up: bloom + sun-aware sky halo (outlines retained)

Status: open (full plan; ready for execution)

## Context

The art direction is "Painted Wilds", documented in
`docs/knowledge/conventions/art-direction.md`: soft cel bands, pigment
palettes, a painted sky, both outline systems retained. Its shading
law says bloom/glow, _when added_,
must read as soft painted light (sun, glints), never neon emissives. Its
line law says both outline systems stay: inverted-hull shells on karts/
props and the terrain Sobel pass (`src/materials/postOutline.ts`).

The game today has NO bloom. The per-view composer built in
`src/core/Renderer.ts` `buildSlot()` is `RenderPass -> PostOutlinePass
(terrain Sobel) -> OutputPass (ACES + sRGB) -> SkyPosterizePass`. The
readBuffer is linear HDR (materials skip tonemap while
`currentRenderTarget != null`); `OutputPass` is the single tonemap.
064 already shipped a corner vignette + day-phase color grade into
`SkyPosterizePass` as neutral-by-default uniforms
(`docs/knowledge/materials/post-grade.md`).

Bright-pixel sources bloom would pick up today:

- `src/environment/SunDisc.ts` — additive `MeshBasicMaterial`, layer 0,
  `depthWrite:false`, opacity = `1 - nightFactor`.
- Renderer's Preetham `Sky` sun (layer 2, `Renderer.ts`).
- Water sun-glints from 062 (`src/materials/celWater.ts`, quantized
  Blinn-Phong `color += uSunColor * glint`), gated OFF on low tier
  (`quality.ts` `waterGlintIntensity: 0`).
- `DynamicSky` moon (night; potential unwanted night bloom).

The load-bearing constraint: `SkyPosterizePass` REPLACES sky pixels
(depth ~ 1.0, `uBandMix` 0.7) with a synthetic gradient AFTER tonemap.
Bloom computed on sky pixels would be OVERWRITTEN, so bloom alone cannot
produce a halo IN the sky. Only the SunDisc core (layer 0, captured by
posterize's depth pre-pass, survives) and bloom bleeding onto terrain
silhouettes would read. The fix: make `SkyPosterizePass` sun-aware so
the painted sky halo composes correctly.

This supersedes the open plan 064's old "no HDR bloom" non-goal — but
064 already shipped its vignette + grade scope, so 074 does NOT re-scope
064; it only adds glow/bloom on top.

## Goal

- Add `UnrealBloomPass` in LINEAR HDR before `OutputPass` -> sun-disc
  core glow, water-glint glow, bright-sand glow, foreground-silhouette
  bleed. Reads as SOFT PAINTED LIGHT, never neon; cel base colors stay
  readable (high threshold).
- REVISE `SkyPosterizePass` to be sun-aware: a projected sun screen-uv +
  soft radial halo folded into the synthetic painted gradient, SKY-MASKED
  (terrain-occluded for free via the existing `tDepth`), fading by
  `1 - nightFactor`, neutral by default. This is the painted sky halo
  bloom cannot do.
- Soften/brighten `SunDisc` so bloom reads a glowing painted core.
- Bloom strength/radius/threshold knob in quality tiers (best-looking
  default; low tier softer, NOT off).
- KEEP `PostOutlinePass` (terrain Sobel) and inverted-hull outlines — the
  line law is non-negotiable; this plan never removes either.

## Non-goals

- No outline removal or restyle. Both outline systems stay (line law).
  Warm line color (sepia/near-iron) is separate open work -> concept 081.
- No god rays / lens flare / god-ray occlusion -> concept 079 (feasible
  now via the SkyPosterize depth mask; out of scope here).
- No vignette / day-phase color grade — already shipped by 064.
- No DOM/CSS vignette or grain (that is 072's UI chrome).
- No per-biome color grade (073 owns tropical color; grade is out of
  scope).
- No gameplay/physics changes.

## Architecture (change)

```text
src/materials/sunGlow.ts            # NEW PURE (jsdom-tested):
                                    #   projectSunUv(sunDirWorld, camera)
                                    #     -> {uv, visible} (behind-camera /
                                    #     off-screen -> visible false);
                                    #   glowIntensity(elevDeg, sunInt,
                                    #     nightFactor, tierScale) -> 0..1
                                    #     (peaks dawn/dusk, 0 at night).
                                    # Keeps Renderer under the 600-line cap.
src/materials/sunGlow.test.ts       # projectSunUv center/edge/behind-camera;
                                    #   glowIntensity 0 at night, peaks low
                                    #   elevation, 0 when sunIntensity 0.
src/materials/skyPosterize.ts       # +uSunUv, uSunVisible,
                                    #  uSunGlow{Radius,Intensity,Color},
                                    #  uAspect. In the sky branch: add a
                                    #  soft sun hotspot + radial falloff to
                                    #  `synthetic` BEFORE mix(color,
                                    #  synthetic, uBandMix). Neutral defaults
                                    #  (intensity 0) -> byte-identical
                                    #  identity path.
src/materials/skyPosterize.test.ts  # new uniforms exist + neutral; shader
                                    #  has the glow term; identity path at
                                    #  intensity 0.
src/core/quality.ts (+ .test.ts)    # +bloom {strength, radius, threshold}
                                    #  per tier; low softer not off. Pure.
src/core/Renderer.ts                # buildSlot: insert UnrealBloomPass
                                    #  (RenderPass -> PostOutlinePass ->
                                    #  UnrealBloomPass -> OutputPass ->
                                    #  SkyPosterize); ComposerSlot gains
                                    #  bloom + resize; setQuality re-applies
                                    #  bloom params. renderViews: per slot
                                    #  project sun uv via sunGlow helper,
                                    #  write uSunUv/uSunVisible/
                                    #  uSunGlowColor (dayCycle sunColor ->
                                    #  sRGB)/ uSunGlowIntensity into
                                    #  slot.skyPosterize (fan-out mirrors
                                    #  zenith/horizon).
src/environment/SunDisc.ts          # softer/larger falloff so bloom core
                                    #  reads as a painted halo; keep
                                    #  additive, depthWrite:false,
                                    #  (1-nightFactor) fade.
docs/knowledge/core/renderer.md     # schema: layer 1 post-proc unchanged
                                    #  (Sobel stays); +bloom pass; posterize
                                    #  sun-aware.
docs/knowledge/data-flows/render-pipeline.md # mermaid + prose chain refresh.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(materials): pure sun-glow projection helpers`
   - `sunGlow.ts` + `sunGlow.test.ts`: `projectSunUv`
     (center/edge/behind-camera cases), `glowIntensity` (0 at night, peaks
     low-elevation, 0 when sunIntensity 0).
2. `feat(materials): sun-aware sky halo in SkyPosterizePass`
   - `skyPosterize.ts` new uniforms + soft glow term in the sky branch;
     neutral defaults = identity. Tests assert uniforms + shader term +
     identity path. Color-space note: glow color is sRGB (post-tonemap
     space).
3. `feat(core): UnrealBloomPass (linear HDR) + per-view sun-glow wiring`
   - `quality.ts` bloom knobs + test; `Renderer.buildSlot` insert bloom +
     verify HalfFloat readBuffer; `ensureSlot` bloom resize; `setQuality`
     re-applies bloom params; `renderViews` projects sun uv + writes glow
     uniforms per slot. Watch Renderer 600-line cap — pure math stays in
     `sunGlow.ts`. PostOutlinePass stays in the chain, untouched.
4. `feat(environment): soften/brighten SunDisc for bloom halo core`
   - `SunDisc.ts` softer falloff (procedural, no asset); bloom now reads a
     glowing disc core.
5. `docs: knowledge refresh; concept 079; move 074`
   - Refresh `render-pipeline.md`, `core/renderer.md`; create
     `docs/backlog/concept/079_godrays-lensflare.md`; add
     `docs/troubleshooting/<date>_074-bloom.md`; move 074 -> pending-review.

## Look targets

- Sun-disc core glows (bloom on layer-0 disc); soft golden HALO IN THE
  PAINTED SKY (sun-aware SkyPosterize), strongest at dawn/dusk, HARD-CUT
  by terrain silhouettes (the dune-half-eaten sunset), fading to none at
  night.
- Gentle bloom on water glints (med/high; off on low since glint is off)
  and bright sand; cel base colors stay readable. Reads as painted light,
  never neon.
- Terrain Sobel outlines + inverted-hull outlines unchanged.
- Bloom + halo present and correct in both halves of 2P split-screen;
  resizes per slot.

## Risks

- Bloom washing out cel/toon colors — high threshold (~0.7+), subtle
  strength; F3 tune. Art direction: soft painted, never neon.
- SkyPosterize sun-uv projection must be per-slot (each view has its own
  camera); behind-camera -> `uSunVisible=false` -> glow 0 (unit-tested,
  not left to the shader).
- Color space: SkyPosterize runs post-tonemap sRGB; glow color must be
  sRGB (convert dayCycle `sunColor`). Verify no double-brightening with
  the SunDisc core.
- `Renderer.ts` (~528 lines) near the 600 cap — keep all projection/glow
  math in pure `sunGlow.ts`; if threatened, split the per-slot glow write
  into a helper.
- Night moon bloom — verify the `DynamicSky` moon does not unwantedly
  bloom at night (gate or accept).
- Water glint off on low tier -> no glint bloom on low (accepted; low tier
  softer overall).
- Per-view composer resize: bloom pass must resize with the slot in
  split-screen; SkyPosterize glow uv is normalized so aspect handled via
  uAspect.
- No committed render goldens exist yet; verify by eye + F3.

## Acceptance

- [ ] Terrain Sobel + inverted-hull outlines intact and unchanged.
- [ ] Soft golden sky halo around the sun, terrain-occluded; none at
      night; SunDisc core glows; highlights glow gently; cel colors not
      washed out; reads as painted light, not neon.
- [ ] Bloom + halo correct in both 2P split-screen halves; resizes
      correctly.
- [ ] Quality knob adjusts bloom per tier (best-looking default; low
      softer, not off).
- [ ] Neutral SkyPosterize glow defaults reproduce pre-074 output
      (identity path test).
- [ ] Behind-camera sun never draws a halo (test + drive-away check).
- [ ] Zero asset files; touched files `<= 600` lines; lines `<= 100`
      chars.
- [ ] `npm run verify` + hooks green.

## Verification

- `npm run dev`; F3 sweep across dawn/day/dusk/night — confirm halo
  strength tracks the sun + fades at night, terrain cuts it, highlights
  glow, colors stay readable.
- 2P split-screen dusk race: bloom + halo present in both halves; resize
  window.
- Toggle quality tiers: bloom softens on low, strong on high; no crash on
  resize.
- Confirm terrain + kart outlines are visually unchanged vs main.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Independent. Reads `dayCycleState` (sunDirWorld, sunColor, sunIntensity,
nightFactor, sunElevationDeg) and `quality.ts`. Composes with 064 (grade
and vignette already in SkyPosterize; 074 adds glow on top, does not
re-scope it) and 062 (water glints bloom for free on med/high). Warm line
color is separate open work (concept 081). God rays and lens flare are
deferred to concept 079.
