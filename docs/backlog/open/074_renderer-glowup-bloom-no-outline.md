# 074 Renderer glow-up: retire terrain Sobel + bloom + sun-aware sky halo

Status: open (full plan; ready for execution)

## Context

The reference "Palm Shore — Golden Hour" reads from a warm sun halo in the sky
plus soft glow on the sun core and bright highlights. The game today has NO
bloom. The per-view composer built in `src/core/Renderer.ts` `buildSlot()`
(~line 342) is `RenderPass -> PostOutlinePass (terrain Sobel,
src/materials/postOutline.ts) -> OutputPass (ACES + sRGB) ->
SkyPosterizePass`. The readBuffer is linear HDR (materials skip tonemap while
`currentRenderTarget != null`); `OutputPass` is the single tonemap.

Bright-pixel sources bloom would pick up today (more than the old plan named):

- `src/environment/SunDisc.ts` — additive `MeshBasicMaterial`, layer 0,
  `depthWrite:false`, opacity = `1 - nightFactor`.
- Renderer's Preetham `Sky` sun (layer 2, `Renderer.ts:163`).
- Water sun-glints from 062 (`src/materials/celWater.ts:172`, quantized
  Blinn-Phong `color += uSunColor * glint`), gated OFF on low tier
  (`quality.ts` `waterGlintIntensity: 0`).
- `DynamicSky` moon (night; potential unwanted night bloom).

The load-bearing constraint the old plan underweighted: `SkyPosterizePass`
REPLACES sky pixels (depth ~ 1.0, `uBandMix` 0.7) with a synthetic gradient
AFTER tonemap. With the old plan's order (`RenderPass -> Bloom -> OutputPass
-> SkyPosterize`), bloom computed on sky pixels is OVERWRITTEN — so bloom
alone cannot produce a halo IN the sky. Only the SunDisc core (layer 0,
captured by posterize's depth pre-pass, survives) and bloom bleeding onto
terrain silhouettes would read. That loses the golden-hour sky halo — the
money shot.

User direction: drop the terrain Sobel style; disregard 2P cost; REVISE
`SkyPosterize` to be sun-aware so the sky halo composes correctly; keep bloom
in linear HDR for highlights. God rays + lens flare -> separate concept (079).
This supersedes the "no HDR bloom" non-goal in the open plan 064 and MERGES
064's analytic sun-glow into this task (064 is re-scoped to vignette + grade).

## Goal

- Retire `PostOutlinePass` (terrain Sobel) from the composer; delete
  `postOutline.ts`. Inverted-hull outlines (layer 0, karts/props) stay.
- Add `UnrealBloomPass` in LINEAR HDR before `OutputPass` -> sun-disc core
  glow, water-glint glow, bright-sand glow, foreground-silhouette bleed. Cel
  base colors stay readable (high threshold).
- REVISE `SkyPosterizePass` to be sun-aware: add a projected sun screen-uv +
  a bright sun hotspot / soft radial halo folded into the synthetic gradient,
  SKY-MASKED (terrain-occluded for free via the existing `tDepth`), fading by
  `1 - nightFactor`, neutral by default. This is the sky halo bloom can't do.
- Soften/brighten `SunDisc` so bloom reads a glowing core (not a hard dot).
- Bloom strength/radius/threshold knob in quality tiers (best-looking default;
  low tier softer, NOT off).

## Non-goals

- No god rays / lens flare / god-ray occlusion -> NEW concept stub 079
  (feasible now via the SkyPosterize depth mask; out of scope here).
- No vignette / day-phase color grade — those remain 064's scope (re-scoped).
- No DOM/CSS vignette or grain (that is 072's UI chrome).
- No per-biome color grade (073 owns tropical color; grade is out of scope).
- No gameplay/physics changes.

## Architecture (change)

```text
src/materials/postOutline.ts        # DELETE (+ postOutline.test.ts); no other
                                    # consumers.
src/materials/sunGlow.ts            # NEW PURE (jsdom-tested):
                                    #   projectSunUv(sunDirWorld, camera)
                                    #     -> {uv, visible} (behind-camera /
                                    #     off-screen -> visible false);
                                    #   glowIntensity(elevDeg, sunInt,
                                    #     nightFactor, tierScale) -> 0..1
                                    #     (peaks dawn/dusk, 0 at night).
                                    # Mirrors 064's projectSunUv spec; keeps
                                    # Renderer under the 600-line cap.
src/materials/skyPosterize.ts       # +uSunUv, uSunVisible,
                                    #  uSunGlow{Radius,Intensity,Color}, uAspect.
                                    # In the sky branch: add sun hotspot +
                                    # radial falloff to `synthetic` BEFORE
                                    # mix(color, synthetic, uBandMix). Neutral
                                    #  defaults (intensity 0) -> byte-identical
                                    # identity path.
src/materials/skyPosterize.test.ts  # new uniforms exist + neutral; shader has
                                    # the glow term; identity path at intensity 0.
src/core/quality.ts (+ .test.ts)    # +bloom {strength, radius, threshold} per
                                    # tier; low softer not off. Pure.
src/core/Renderer.ts                # buildSlot: drop PostOutlinePass; insert
                                    #  UnrealBloomPass (RenderPass ->
                                    #  UnrealBloomPass -> OutputPass ->
                                    #  SkyPosterize); ComposerSlot gains bloom +
                                    #  resize; setQuality re-applies bloom params.
                                    #  renderViews: per slot project sun uv via
                                    #  sunGlow helper, write uSunUv/uSunVisible/
                                    #  uSunGlowColor (dayCycle sunColor -> sRGB)/
                                    #  uSunGlowIntensity into slot.skyPosterize
                                    #  (fan-out mirrors zenith/horizon).
src/environment/SunDisc.ts          # softer/larger falloff so bloom core reads
                                    #  as a halo; keep additive, depthWrite:false,
                                    #  (1-nightFactor) fade.
docs/knowledge/core/renderer.md     # schema: layer 1 post-proc -> none; +bloom
                                    #  pass; posterize sun-aware.
docs/knowledge/data-flows/render-pipeline.md # mermaid + prose chain refresh.
docs/knowledge/materials/outlines.md # drop PostOutlinePass row; keep
                                    #  inverted-hull.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `refactor(materials): retire terrain Sobel outline pass from composer`
   - `Renderer.buildSlot`/`ComposerSlot`/`renderViews`/`dispose` drop
     `PostOutlinePass`; delete `postOutline.ts` + test; refresh FrameStats +
     buildSlot doc comments (chain now `RenderPass -> OutputPass ->
SkyPosterize`); update `outlines.md`, `render-pipeline.md`,
     `core/renderer.md`. Terrain loses Sobel edges (accepted).
2. `feat(materials): pure sun-glow projection helpers`
   - `sunGlow.ts` + `sunGlow.test.ts`: `projectSunUv` (center/edge/behind-camera
     cases), `glowIntensity` (0 at night, peaks low-elevation, 0 when
     sunIntensity 0).
3. `feat(materials): sun-aware sky halo in SkyPosterizePass`
   - `skyPosterize.ts` new uniforms + glow term in the sky branch; neutral
     defaults = identity. Tests assert uniforms + shader term + identity path.
     Color-space note: glow color is sRGB (post-tonemap space).
4. `feat(core): UnrealBloomPass (linear HDR) + per-view sun-glow wiring`
   - `quality.ts` bloom knobs + test; `Renderer.buildSlot` insert bloom +
     verify HalfFloat readBuffer; `ensureSlot` bloom resize; `setQuality`
     re-applies bloom params; `renderViews` projects sun uv + writes glow
     uniforms per slot. Watch Renderer 600-line cap — pure math stays in
     `sunGlow.ts`.
5. `feat(environment): soften/brighten SunDisc for bloom halo core`
   - `SunDisc.ts` softer falloff (procedural, no asset); bloom now reads a
     glowing disc core.
6. `docs: knowledge refresh; reconcile 064; concept 079; move 074`
   - Refresh `render-pipeline.md`, `core/renderer.md`, `materials/outlines.md`;
     RE-SCOPE 064 to vignette + day-phase grade only (remove its analytic
     sun-glow section + no-bloom non-goal; note 074 owns glow/bloom); create
     `docs/backlog/concept/079_godrays-lensflare.md`; add
     `docs/troubleshooting/<date>_074-bloom.md`; move 074 -> pending-review.

## Look targets

- Sun-disc core glows (bloom on layer-0 disc); soft golden HALO IN THE SKY
  (sun-aware SkyPosterize), strongest at dawn/dusk, HARD-CUT by terrain
  silhouettes (the dune-half-eaten sunset), fading to none at night.
- Gentle bloom on water glints (med/high; off on low since glint is off) and
  bright sand; cel base colors stay readable.
- No crisp terrain Sobel lines; flat-shaded look accepted.
- Bloom + halo present and correct in both halves of 2P split-screen; resizes
  per slot.

## Risks

- Bloom washing out cel/toon colors — high threshold (~0.7+), subtle strength;
  F3 tune.
- SkyPosterize sun-uv projection must be per-slot (each view has its own
  camera); behind-camera -> `uSunVisible=false` -> glow 0 (unit-tested, not
  left to the shader).
- Color space: SkyPosterize runs post-tonemap sRGB; glow color must be sRGB
  (convert dayCycle `sunColor`). Verify no double-brightening with the SunDisc
  core.
- `Renderer.ts` (~528 lines) near the 600 cap — keep all projection/glow math
  in pure `sunGlow.ts`; if threatened, split the per-slot glow write into a
  helper.
- Night moon bloom — verify the `DynamicSky` moon does not unwantedly bloom at
  night (gate or accept).
- Water glint off on low tier -> no glint bloom on low (accepted; low tier
  softer overall).
- Per-view composer resize: bloom pass must resize with the slot in
  split-screen; SkyPosterize glow uv is normalized so aspect handled via
  uAspect.
- Render goldens (052) not landed — no baselines exist; nothing to refresh.

## Acceptance

- [ ] No terrain Sobel anywhere; `PostOutlinePass` / `postOutline.ts` gone;
      inverted-hull outlines intact.
- [ ] Soft golden sky halo around the sun, terrain-occluded; none at night;
      SunDisc core glows; highlights glow gently; cel colors not washed out.
- [ ] Bloom + halo correct in both 2P split-screen halves; resizes correctly.
- [ ] Quality knob adjusts bloom per tier (best-looking default; low softer,
      not off).
- [ ] Neutral SkyPosterize glow defaults reproduce pre-074 output (identity
      path test).
- [ ] Behind-camera sun never draws a halo (test + drive-away check).
- [ ] Zero asset files; touched files `<= 600` lines; lines `<= 100` chars.
- [ ] `npm run verify` + hooks green.

## Verification

- `npm run dev`; F3 sweep across dawn/day/dusk/night — confirm halo strength
  tracks the sun + fades at night, terrain cuts it, highlights glow, colors
  stay readable.
- 2P split-screen dusk race: bloom + halo present in both halves; resize
  window.
- Toggle quality tiers: bloom softens on low, strong on high; no crash on
  resize.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Independent. Merges 064's analytic sun-glow into this task (re-scope 064 to
vignette + day-phase grade only). Reads `dayCycleState` (sunDirWorld /
sunColor / sunIntensity / nightFactor / sunElevationDeg) + `quality.ts`.
Composes with 073 (tropical golden hour — 073's sun halo unblocked once this
lands) and 062 (water glints bloom for free on med/high). God rays / lens
flare deferred to concept 079.
