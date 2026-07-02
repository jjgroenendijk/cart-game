# 064 Post polish: sun glow, vignette, time-of-day grade

Status: open (full plan; ready for execution)

## Context

The composer chain per view slot is RenderPass -> PostOutlinePass ->
OutputPass (ACES + sRGB) -> SkyPosterizePass (`core/Renderer.ts:345`).
After tone mapping the frame ships raw: no vignette, no grade, and
light is purely diffuse — the sun is a flat `SunDisc` billboard with
zero halo, so dawn/dusk (reachable via 042 race config) never blooms.
What "fancy" post looks like for this game:

- Sun glow: a warm halo around the sun that terrain occludes. Classic
  bloom (bright-pass + blur chain) is the wrong tool — it costs 2+
  full-screen passes per view (x2 in split-screen) and blooms white
  cel highlights indiscriminately. An ANALYTIC glow — radial falloff
  around the projected sun position, gated to sky pixels — costs a few
  ALU in an existing pass and only ever glows the sun.
- Vignette: a subtle corner darkening that frames the action and hides
  the flat ambient at screen edges; per-view (each split-screen half
  gets its own frame), which falls out naturally of per-slot passes.
- Grade: one saturation/lift tweak driven by time of day — dusk gets
  warmer and ~5% more saturated, night desaturates and cools. dayCycle
  already computes phase tints (`environment/dayCycle.ts` phase table);
  this reuses its state, no new cycle logic.

The load-bearing observation: `SkyPosterizePass` is ALREADY the last
pass, already samples the post-tonemap frame (`tColor`) and owns a
non-sky depth mask (`tDepth`, cleared-to-1 = sky pixel). Folding glow +
vignette + grade into its fragment shader adds ZERO passes and ZERO
render targets — the sky mask gates the glow (terrain occludes it for
free), and the grade applies uniformly after posterize. Sun screen
position is one CPU-side project of `dayCycleState.sunDirWorld` per
view per frame.

Constraints: OutputPass applies ACES+sRGB once — these are display-
space stylization ops, correctly downstream of it (posterize already
lives there); Renderer writes shared uniforms once per frame per view
(`renderViews` refresh point); 039 (concept: composer mask/depth
share) touches the same pass — keep the mask contract unchanged.

## Goal

The frame gets a finishing pass: an occlusion-aware sun halo that makes
dawn/dusk glow, a gentle vignette, and a day-phase color grade — all
inside the existing final pass, costing no extra passes or targets,
tier-gated, defaults subtle enough that daytime temperate reads almost
identical (this is polish, not a new look).

## Non-goals

- No true HDR bloom, lens flare ghosts, or god rays (a follow-up
  concept if the analytic glow proves the appetite; god rays need the
  039 depth-share work first).
- No per-biome grade in v1 (biome mood is fog/sky's job, 025); grade
  keys on day phase only.
- No user-facing settings row; tier gating only (a grade toggle can
  join the settings overlay later if anyone asks).
- No DOM/CSS vignette (must live in the same pixel pipeline as the
  posterize so split-screen and stills stay consistent).

## Architecture (change)

```text
src/materials/
  postGrade.ts       # NEW PURE: mirrored math, jsdom-tested:
                     #   vignetteFactor(uv, strength, radius);
                     #   sunGlow(uv, sunUv, sunVisible, radius,
                     #     intensity) -> radial falloff (smooth pow
                     #     falloff, NOT banded - a banded halo reads
                     #     as rings/artifact; posterize already owns
                     #     the sky's banding and runs before glow);
                     #   gradeFor(phase mix) -> {saturation, warmth,
                     #     lift} interpolated from a 4-entry table
                     #     [dawn, day, dusk, night] (same index
                     #     convention as dayCycle's phase curves);
                     #   projectSunUv(sunDirWorld, camera) -> uv +
                     #     behind-camera flag (pure via matrices).
  skyPosterize.ts    # frag gains: uVignette{Strength,Radius},
                     #   uSunUv, uSunGlow{Radius,Intensity,Color},
                     #   uGrade{Sat,Warm,Lift}, uAspect. Order inside
                     #   main(): posterize (existing, sky-masked) ->
                     #   glow add (masked to sky via tDepth, sun
                     #   color from uniform) -> grade -> vignette.
                     #   All new features neutral-by-default uniforms
                     #   (glow 0, grade identity, vignette 0) so
                     #   existing shader tests + look stay valid
                     #   until the Renderer wires values.
src/core/
  Renderer.ts        # renderViews: per slot, projectSunUv with the
                     #   slot camera + dayCycleState.sunDirWorld;
                     #   write sun uv/visibility/color (sun tint x
                     #   intensity from dayCycleState) + grade values
                     #   (phase-mixed once per frame, shared across
                     #   slots) into that slot's SkyPosterizePass.
  quality.ts         # low tier: glow intensity 0 (vignette + grade
                     #   are ~free ALU, stay on for all tiers).
```

## Look targets

- Glow: radius ~12% of screen height at full sun, intensity peaking
  at dawn/dusk (scales with sun tint x a low-elevation boost), zero
  at night (sun below horizon -> visibility flag false). Terrain and
  karts occlude it hard via the sky mask — a sunset half-eaten by a
  dune silhouette is the money shot.
- Vignette: ~12% darkening at corners, wide radius; invisible until
  you A/B it, missed when it is gone.
- Grade: day = identity. Dawn/dusk: warmth +0.04, saturation +0.06.
  Night: saturation -0.15, warmth -0.05, lift +0.01 (crushed blacks
  stay readable). Phase mixing uses dayCycle's existing phase blend
  so grades cross-fade exactly like the sky tints do.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(materials): pure post-grade math (vignette, glow, grade)`
   - `postGrade.ts` + tests: vignette corners/center pinning, glow
     falloff monotonic + zero when invisible, grade table identity at
     day, projectSunUv against hand-computed camera cases (center,
     edge, behind-camera).
2. `feat(materials): fold glow + grade + vignette into final pass`
   - `skyPosterize.ts` shader + uniforms (neutral defaults). Tests:
     shader source mirrors pure expressions, defaults produce
     identity (posterize-only) output path, uniform list.
3. `feat(core): renderer drives sun glow + day-phase grade per view`
   - Renderer per-slot writes + quality gating + tests (mock slot
     asserts uniform writes; night -> glow 0; low tier -> glow 0).
4. `docs: AGENTS refresh + backlog move`
   - `src/AGENTS.md` composer note (final pass = posterize + grade);
     note for 039 that the final pass now also consumes the sky mask
     for glow (mask contract unchanged); move 064 to pending-review.

## Risks

- Split-screen cost: zero added passes; added ALU runs once per
  pixel in the existing final pass — the cheapest possible shape.
  Still F3-verify 2P on low tier.
- Double-styling the sky: glow adds on top of the posterized sky;
  a strong glow could wash out sky bands near the sun. Mitigation:
  glow is additive AFTER posterize with modest intensity; SunDisc
  already provides the hot core so the halo can stay soft; visual
  check at dawn/dusk is commit-3 acceptance.
- Behind-camera sun: projected uv flips across the origin (w < 0).
  projectSunUv returns a visibility flag; glow forced to 0 —
  unit-tested, not left to the shader.
- 042 frozen-time configs: users can pin dusk permanently; the grade
  must be stable (pure fn of phase mix, no temporal accumulation).
- 052 stills: output changes for golden scenes (that is the point).
  Land order note: if 052's harness is live first, refresh goldens in
  commit 3; determinism holds (grade is a pure fn of frozen time).
- 039 overlap: both edit skyPosterize. This plan only ADDS uniforms +
  tail-of-main code; the depth/mask plumbing 039 studies is untouched.
  Whichever lands second rebases trivially (disjoint hunks).

## Acceptance

- [ ] Dawn/dusk: visible warm halo around the sun, hard-occluded by
      terrain/kart silhouettes; noon: subtle; night: none.
- [ ] Vignette present in every view (both 2P halves independently),
      ~12% corner darkening, no banding.
- [ ] Grade: night visibly desaturated/cool, dusk warm; day within a
      hair of pre-064 output (A/B still diff confined to corners/
      vignette).
- [ ] Neutral uniforms reproduce pre-064 output exactly (identity
      path test) — the feature is fully data-driven.
- [ ] Low tier: glow off, vignette + grade on, frame time unchanged
      (F3 EWMA); no new render targets allocated (memory counters).
- [ ] Behind-camera sun never draws a glow (test + drive-away check).
- [ ] All files <= 600 lines; `npm run verify` + hooks green.

## Verification

- F3 sweep with 042 time-of-day config through all four phases on
  temperate + desert (dune occlusion shot) + alpine.
- 2P split-screen dusk race on low tier: fps, memory counters, both
  vignettes correct per viewport.
- A/B toggle by zeroing uniforms in devtools to confirm the identity
  path and calibrate subtlety.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reads dayCycleState (042 exposes configured/frozen
time), SkyPosterizePass mask (039 concept touches the same file —
coordinate land order, hunks disjoint), quality tiers (011). Composes
with 054 (storm dimming multiplies into sun intensity -> glow follows
weather for free) and 052 (goldens refresh once). Follow-up concepts
unlocked, not included: god rays via 039 depth share, kart headlight
glow sprites at night reusing the analytic-glow helper.
