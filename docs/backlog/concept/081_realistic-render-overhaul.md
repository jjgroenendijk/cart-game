# 081 Realistic render overhaul (sky + whole-game)

Status: open (concept - to be refined)

## Context

Direction change: move the game's look from the current stylized cel/Ghibli
target to a realistic one. The trigger was the sky (raw Preetham atmosphere is
physically-based but the pipeline hides it), but the decision is whole-game
realistic, not sky-only.

Today the look is stylized by construction:

- `materials/CelMaterial` (banded diffuse), tier-gated 069 surface detail.
- `materials/postOutline.ts` Sobel edge pass (layer 1).
- `materials/skyPosterize.ts` repaints a synthetic zenith->horizon gradient over
  the three.js addons `Sky` (Preetham), plus the 064 day grade + vignette.
- Fixed `toneMappingExposure = 1.0` (ACES). Bright sky -> ACES wash / near-white.
- Lighting: `HemisphereLight` ambient + one `DirectionalLight` sun; PCF shadows.
- Day cycle drives tints via `environment/dayCycle.ts` -> `dayCycleState`.

So "realistic" is less about adding tech and more about removing the
stylization layer and fixing what made the physical sky look bad: exposure and
lighting. Interim fix PR #111 made SkyPosterize/PostOutline always-on to kill
the white menu sky; the realistic path removes the sky posterize entirely, so
parts of #111 are superseded (keep #111 as the stopgap).

## Goal

A realistic, coherent look across sky, terrain, karts, props, water:

- Whole-game realistic (not sky-only): PBR materials, no cel banding, no Sobel
  outlines.
- Auto-exposure (eye adaptation): scene-luminance-driven `toneMappingExposure`
  so a bright real sky sits correctly next to darker ground and never clips.
- Physically-plausible day cycle: sun elevation drives atmosphere tint (blue
  midday -> warm low sun), matched fog/aerial perspective, correct night.
- HDR-friendly: bounded sky body, bright bounded sun disc -> clean bloom input
  (coordinate with the 074 bloom work).

## Proposed phasing (dependency-ordered; each ~one PR)

- Phase 0 Auto-exposure foundation. Luminance-reduction pass over the HalfFloat
  HDR buffer + temporal adaptation feeding `toneMappingExposure` (no three.js
  built-in; custom pass). Independently valuable; alone stops the sky blowing
  out. Best first slice.
- Phase 1 Sky realism. Drop the posterize sky replacement; drive Preetham
  uniforms from sun elevation; real HDR sun disc; matched fog. Generate an IBL
  environment map from the sky (PMREMGenerator) per phase.
- Phase 2 PBR materials + remove outlines. CelMaterial -> standard PBR for
  terrain/karts/props; wire IBL env + sun; delete PostOutlinePass and the sky
  half of SkyPosterizePass. Large; heavy material-test churn.
- Phase 3 Aerial perspective / height fog tied to atmosphere; realistic water;
  realistic clouds.
- Phase 4 Bloom + final tonemap polish (merge with 074 direction).

## Needs refinement

- Auto-exposure interacts with the whole frame (terrain/karts/UI readability),
  not just sky -> tune metering (log-avg luminance, key value), adaptation
  speed, and min/max exposure clamps; verify HUD/menu chrome stays legible.
- Test strategy: many `materials/*.test.ts` assert cel shader source / banding.
  Realistic materials invalidate them -> plan the rewrite, keep pure helpers
  WebGL-free per the jsdom convention.
- Performance on a web + tier-gated target: PBR + IBL + auto-exposure + bloom
  stacks up. Decide per-tier fallbacks (low tier may keep cheaper shading).
- Art coherence during transition: intermediate phases mix realistic sky with
  cel ground -> sequence so mixed states are short; consider a feature flag.
- 069 surface detail, biome sky/fog bias, stars/moon meshes: decide keep vs
  fold into the realistic sky/material model.
- Invariants doc (`docs/knowledge/conventions/`, height pipeline) and the 069
  / 072 / 073 look notes need updates as the cel look is removed.

## Depends on / coordinates with

- 074 bloom (`docs/074-bloom-plan-rework`) - bloom belongs after auto-exposure.
- PR #111 menu sky/fog fix - interim; superseded in part by Phase 1.
- 025 biome framework - biome sky/fog bias must keep working under the new sky.
