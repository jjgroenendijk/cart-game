# 064 Post polish: vignette, time-of-day grade

Status: pending-review (implemented; ready for review)

## Context

NOTE: this task was RE-SCOPED. It originally also owned an analytic sun glow;
that glow moved to 074 (where it became the sun-aware `SkyPosterizePass`
revision that pairs with bloom). 074 supersedes this task's former "no HDR
bloom" non-goal. This task now owns ONLY the vignette + day-phase grade.

The composer chain per view slot is `RenderPass -> PostOutlinePass ->
OutputPass (ACES + sRGB) -> SkyPosterizePass` (`core/Renderer.ts:345`; 074
will drop PostOutlinePass and insert an UnrealBloomPass before OutputPass).
After tone mapping the frame ships raw: no vignette, no grade. Two cheap
finishing ops:

- Vignette: a subtle corner darkening that frames the action and hides the
  flat ambient at screen edges; per-view (each split-screen half gets its own
  frame), which falls out naturally of per-slot passes.
- Grade: one saturation/lift tweak driven by time of day — dusk gets warmer
  and ~5% more saturated, night desaturates and cools. `dayCycle` already
  computes phase tints (`environment/dayCycle.ts` phase table); this reuses
  its state, no new cycle logic.

The load-bearing observation: `SkyPosterizePass` is ALREADY the last pass,
already samples the post-tonemap frame (`tColor`) and owns a non-sky depth
mask (`tDepth`, cleared-to-1 = sky pixel). Folding vignette + grade into its
fragment shader adds ZERO passes and ZERO render targets, and the grade
applies uniformly after posterize. (The sun-aware halo that 074 adds to the
same pass is disjoint work — vignette + grade are uniform per pixel, the halo
is radial around the projected sun uv; hunks do not overlap.)

Constraints: OutputPass applies ACES+sRGB once — these are display-space
stylization ops, correctly downstream of it (posterize already lives there);
Renderer writes shared uniforms once per frame per view (`renderViews`
refresh point); 039 (concept: composer mask/depth share) touches the same
pass — keep the mask contract unchanged.

## Goal

The frame gets a finishing pass: a gentle vignette and a day-phase color
grade — all inside the existing final pass, costing no extra passes or
targets, tier-gated, defaults subtle enough that daytime temperate reads
almost identical (this is polish, not a new look).

## Non-goals

- No sun glow / sun halo (moved to 074) and no HDR bloom (074).
- No lens flare ghosts or god rays (concept stub 079).
- No per-biome grade in v1 (biome mood is fog/sky's job, 025); grade keys on
  day phase only.
- No user-facing settings row; tier gating only (a grade toggle can join the
  settings overlay later if anyone asks).
- No DOM/CSS vignette (must live in the same pixel pipeline as the posterize
  so split-screen and stills stay consistent).

## Architecture (change)

```text
src/materials/
  postGrade.ts       # NEW PURE: mirrored math, jsdom-tested:
                     #   vignetteFactor(uv, strength, radius);
                     #   gradeFor(phase mix) -> {saturation, warmth, lift}
                     #     interpolated from a 4-entry table [dawn, day, dusk,
                     #     night] (same index convention as dayCycle's phase
                     #     curves).
  skyPosterize.ts    # frag gains: uVignette{Strength,Radius}, uGrade{Sat,Warm,
                     #   Lift}. Order inside main(): posterize (existing,
                     #   sky-masked) -> [074's sun halo, if landed] -> grade
                     #   -> vignette. New features neutral-by-default uniforms
                     #   (grade identity, vignette 0) so existing shader tests
                     #   + look stay valid until the Renderer wires values.
src/core/
  Renderer.ts        # renderViews: write grade values (phase-mixed once per
                     #   frame, shared across slots) + vignette into each slot's
                     #   SkyPosterizePass.
  quality.ts         # low tier: vignette + grade stay on (near-free ALU);
                     #   optional grade-strength scalar if a cheaper low tier
                     #   is wanted.
```

## Look targets

- Vignette: ~12% darkening at corners, wide radius; invisible until you A/B
  it, missed when it is gone.
- Grade: day = identity. Dawn/dusk: warmth +0.04, saturation +0.06. Night:
  saturation -0.15, warmth -0.05, lift +0.01 (crushed blacks stay readable).
  Phase mixing uses dayCycle's existing phase blend so grades cross-fade
  exactly like the sky tints do.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(materials): pure post-grade math (vignette, grade)`
   - `postGrade.ts` + tests: vignette corners/center pinning, grade table
     identity at day.
2. `feat(materials): fold vignette + grade into final pass`
   - `skyPosterize.ts` shader + uniforms (neutral defaults). Tests: shader
     source mirrors pure expressions, defaults produce identity (posterize-only
     / halo-only) output path, uniform list.
3. `feat(core): renderer drives day-phase grade + vignette per view`
   - Renderer per-slot writes + quality gating + tests (mock slot asserts
     uniform writes; grade identity at day).
4. `docs: AGENTS refresh + backlog move`
   - `src/AGENTS.md` composer note (final pass = posterize + [halo] + grade +
     vignette); move 064 to pending-review.

## Risks

- Split-screen cost: zero added passes; added ALU runs once per pixel in the
  existing final pass — the cheapest possible shape. Still F3-verify 2P on
  low tier.
- 042 frozen-time configs: users can pin dusk permanently; the grade must be
  stable (pure fn of phase mix, no temporal accumulation).
- 074 overlap: both edit skyPosterize. This plan only ADDS uniforms +
  tail-of-main code (grade + vignette come AFTER the sky/halo branch); the
  sun-halo plumbing 074 adds is disjoint. Whichever lands second rebases
  trivially (disjoint hunks).

## Acceptance

- [ ] Vignette present in every view (both 2P halves independently), ~12%
      corner darkening, no banding.
- [ ] Grade: night visibly desaturated/cool, dusk warm; day within a hair of
      pre-064 output (A/B still diff confined to corners/vignette).
- [ ] Neutral uniforms reproduce pre-064 output exactly (identity path test)
      — the feature is fully data-driven.
- [ ] Low tier: vignette + grade on, frame time unchanged (F3 EWMA); no new
      render targets allocated (memory counters).
- [ ] All files <= 600 lines; `npm run verify` + hooks green.

## Verification

- F3 sweep with 042 time-of-day config through all four phases on temperate.
- 2P split-screen dusk race on low tier: fps, memory counters, both vignettes
  correct per viewport.
- A/B toggle by zeroing uniforms in devtools to confirm the identity path and
  calibrate subtlety.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reads dayCycleState (042 exposes configured/frozen time),
SkyPosterizePass (039 concept touches the same file — coordinate land order,
hunks disjoint), quality tiers (011). Coordinate with 074 (both edit
skyPosterize; disjoint hunks). Follow-up concepts unlocked, not included: god
rays + lens flare (concept stub 079).
