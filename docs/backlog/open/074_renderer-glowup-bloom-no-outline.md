# 074 Renderer glow-up: remove outline pass + add bloom

Status: open (full plan; ready for execution)

## Context

The reference "Palm Shore — Golden Hour" gets much of its look from a real bloom
halo around the sun plus soft glow on specular/water highlights (an
`UnrealBloomPass` over an ACES-tonemapped scene). The game today has NO bloom.
The per-view composer built in `src/core/Renderer.ts` `buildSlot()` (~line 342)
is `RenderPass -> PostOutlinePass (Sobel, src/materials/postOutline.ts) ->
OutputPass (ACES + sRGB) -> SkyPosterizePass`. The render target is HalfFloat
linear until `OutputPass`. The only sun element is `src/environment/SunDisc.ts`
(a flat additive world-space disc) — no halo/bloom.

The user's direction: the Sobel outline art style "was not working" and should be
dropped; 2P split-screen cost can be disregarded; pick the best-looking option
for the sun glow — i.e. real bloom, not an analytic approximation. This
supersedes the "no HDR bloom" non-goal in the open plan 064.

## Goal

- Remove the Sobel outline pass from the composer (retire `PostOutlinePass`).
- Add `UnrealBloomPass` in linear HDR before tonemap so the sun reads as a golden
  blooming halo and bright highlights (water glints, sand) glow softly.
- Make `SunDisc` bright/soft enough that bloom picks it up as a halo.
- Expose a bloom strength/threshold knob in quality tiers (best-looking default;
  low tier may soften, NOT gate off).

## Non-goals

- No DOM/CSS vignette or grain (that is 072's UI chrome).
- No per-biome color grading (073 owns tropical color; grade is out of scope).
- No lens flare / god rays / god-ray occlusion.
- No gameplay/physics changes.

## Architecture (change)

```text
src/core/Renderer.ts        # buildSlot(): drop PostOutlinePass; insert
                            # UnrealBloomPass between RenderPass and OutputPass:
                            # RenderPass -> UnrealBloomPass -> OutputPass ->
                            # SkyPosterizePass. Bloom sized per view; params
                            # from quality tier. Update resize handling.
src/materials/postOutline.ts# retire/unwire (delete if no other consumer).
src/core/quality.ts         # ADD bloom knob (strength/radius/threshold) per
                            # tier; best-looking default, low tier softer.
src/environment/SunDisc.ts  # brighten/soften disc so bloom reads as a halo
                            # (larger soft falloff, higher emissive; keep
                            # depthWrite:false, fade by nightFactor).
docs/knowledge/...          # renderer composer chain refresh; note 074
                            # supersedes 064 no-bloom non-goal; re-scope 064.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `refactor(core): remove Sobel outline pass from composer`
   - `Renderer.ts` chain drops `PostOutlinePass`; unwire/delete
     `postOutline.ts` if unused; keep the rest of the frame identical.
2. `feat(core): add UnrealBloomPass (sun halo + highlight glow)`
   - `Renderer.ts` composer insert (linear HDR, before OutputPass) + resize;
     `quality.ts` bloom knob (strength ~0.5, radius ~0.5, threshold ~0.7 to
     start, tuned).
3. `feat(environment): brighten/soften sun disc for golden halo`
   - `SunDisc.ts` emissive/size/falloff so bloom yields a soft golden halo.
4. `docs: renderer knowledge refresh; reconcile 064; move 074`
   - `docs/knowledge/...`; note supersession of 064's no-bloom non-goal and
     re-scope open 064 to vignette/grade-only (or fold/close it).

## Look targets

- Soft golden sun halo, strongest at dawn/dusk, fading to none at night.
- Gentle highlight bloom on water sun-glints and bright sand; cel base colors
  stay readable (threshold high enough to avoid washout).
- No crisp Sobel silhouettes; flat-shaded look accepted.
- Bloom present and correct in both halves of 2P split-screen.

## Risks

- Bloom washing out cel/toon colors — raise threshold; keep strength subtle.
- Removing outlines may flatten silhouettes on terrain/karts — accepted per user;
  confirm readability at speed.
- Bloom must run in linear HDR before `OutputPass` tonemap on the HalfFloat
  target — wrong ordering blows out or crushes highlights.
- Interaction with `SkyPosterizePass` (runs after OutputPass) — verify the sky
  gradient + sun still compose correctly with bloom.
- Per-view composer resize: bloom pass must resize with the slot in split-screen.
- Render goldens (052) and composer-mask work (039) may need updated baselines.

## Acceptance

- [ ] No Sobel outline anywhere; `PostOutlinePass` removed/unwired.
- [ ] Sun shows a soft golden bloom halo at dawn/dusk; none at night; highlights
      glow gently; cel colors not washed out.
- [ ] Bloom correct in both 2P split-screen halves; resizes correctly.
- [ ] Quality knob adjusts bloom per tier (best-looking default; low tier softer,
      not off).
- [ ] Zero asset files; touched files `<= 600` lines; lines `<= 100` chars.
- [ ] Render goldens updated if affected; `npm run verify` + hooks green.

## Verification

- `npm run dev`; F3 sweep across dawn/day/dusk/night — confirm halo strength
  tracks the sun and fades at night; highlights glow; colors stay readable.
- 2P split-screen: bloom present/correct in both halves; resize window.
- Toggle quality tiers: bloom softens on low, strong on high; no crash on resize.
- `npm run verify:changed` per commit; regenerate/verify render goldens (052).

## Depends on

Independent; unlocks 073's golden-hour sun halo. Supersedes open 064's no-bloom
non-goal (re-scope 064 to vignette/grade-only or close it). Touches render
goldens (052) and composer chain (039). Independent of 072.
