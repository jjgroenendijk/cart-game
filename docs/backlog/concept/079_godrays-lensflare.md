# 079 God rays + lens flare

Status: open (concept - to be refined)

## Context

Split out of the 074 rework. 074 adds bloom (linear HDR, for the sun-disc
core + highlight + silhouette glow) and a sun-aware `SkyPosterizePass` halo
(soft radial glow in the sky, terrain-occluded via the existing `tDepth`
mask). Two related cinematic sun effects were explicitly excluded from 074
and land here if the appetite survives 074's look:

- God rays (crepuscular rays): visible light SHAFTS radiating from the sun,
  cut by silhouettes — the "god-ray occlusion" feel. A bigger, more
  expensive version of 074's terrain-occluded sky halo.
- Lens flare: analytic camera-lens ghost sprites (colored circles/streaks
  over the projected sun). A camera artifact, distinct from atmospheric
  scattering.

The key change since the old "god rays need 039 first" framing: 039 (depth
share) is NOT a hard dependency anymore. `SkyPosterizePass` ALREADY owns a
private depth pre-pass of layers 0+1 (`materials/skyPosterize.ts` `tDepth`,
cleared-to-1 = sky pixel). A god-ray pass can sample THAT mask for the
occlusion term without waiting for 039. 039 only matters for cost (sharing
one depth buffer across passes instead of re-rasterizing); it is not a
blocker for correctness.

Three distinct techniques, do not conflate:

- Bloom (074, landed-first): bright-pass + Gaussian blur. Glows everything
  bright globally.
- God rays (this concept): radial blur from the projected sun screen
  position through an occlusion mask. One+ extra full-screen pass per view
  (x2 split-screen).
- Lens flare (this concept): analytic sprite overlay driven by sun screen
  pos + intensity. Cheap, but a different art language (camera, not sky).

## Goal (to refine)

Decide which (if any) of god rays / lens flare are worth the cost + art
language after 074's bloom + analytic halo land, and refine into a full plan.
Candidate shape:

- God rays: a post-pass that radial-blurs a sun-bright buffer toward the
  projected sun uv, multiplied by the SkyPosterize occlusion mask so terrain
  cuts the shafts. Fades by `1 - nightFactor`; tier-gated (low off).
- Lens flare: a small procedural sprite set (ghost rings, streak) driven by
  `projectSunUv` (074 ships this helper) + `dayCycle` sun intensity. Procedural
  only (zero assets).

## Needs refinement

- Is the 074 analytic halo enough on its own? Land 074 first, A/B, then
  decide. God rays may be redundant next to a strong terrain-occluded halo.
- God-ray pass cost + where it sits in the chain (after SkyPosterize, sRGB?
  or a linear pre-tonemap radial sample?). The occlusion mask read is free
  via the existing SkyPosterize depth RT, but the radial blur is a real
  full-screen pass.
- Lens flare art language: is a "camera" artifact on-brand for a
  flat-shaded cel look, or does it fight the stylization?
- 039 interaction: if 039 lands first and shares depth, the god-ray mask
  read gets cheaper; if not, the private SkyPosterize depth RT suffices.

## Depends on

074 (lands the bloom + sun-aware halo + `projectSunUv` helper + the
SkyPosterize depth mask this concept would reuse). 039 (depth share) is a
cost follow-on, not a blocker. 062 (water glints) + 073 (tropical golden
hour) set the visual bar these effects would have to clear.
