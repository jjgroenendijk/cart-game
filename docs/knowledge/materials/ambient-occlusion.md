---
type: System
title: Ambient Occlusion (GTAO)
description: Screen-space GTAO contact shading; reads shared depth + view normals; tier-gated.
tags: [materials, rendering, post-processing, realism]
timestamp: 2026-07-29T00:00:00Z
---

# Ambient Occlusion (GTAO)

Ground-truth ambient occlusion (issue #235): contact shading where objects meet
— tree/rock bases, under karts, terrain creases — so the world reads planted
instead of floating. A screen-space GTAO pass integrates per-pixel occlusion
over a few horizon-search slices and darkens toward the ambient/skylight floor
rather than crushing to flat black.

The master gain `uAoStrength` defaults to 0, so the unwired pass is
byte-identical to the pre-feature frame. The quality tier scales it (off on
low); a Settings toggle drives it to 0 to disable.

## Inputs (shared buffers)

GTAO needs two screen-space buffers, both captured once per view slot:

- Depth: the existing shared `DepthCapturePass` `DepthTexture` (combined layers
  0+1; sky = cleared far plane 1.0). Reused unchanged.
- View-space normals: a NEW shared `NormalCapturePass` (`src/materials/normalCapture.ts`)
  — a sibling of `DepthCapturePass` that renders the same `nonSkyLayersMask`
  (0b011) with a normal-writing override material into a HalfFloat color RT,
  packing each fragment's view-space normal as `N * 0.5 + 0.5` in RGB. Sky
  (layer 2) is excluded, so those pixels keep the clear colour, which encodes
  the toward-camera normal (0,0,1) packed -> (0.5, 0.5, 1.0) -> minimal
  occlusion. `needsSwap = false`; the texture handle stays stable across
  `setSize`, so the AO pass binds both shared textures once at construction.

The captured view-space normal is approximate for terrain: terrain's shaded
normal is per-fragment from a heightmap in CelMaterial, whereas the capture uses
the geometry vertex normal transformed by `normalMatrix`. That is close enough
for AO and is an accepted tradeoff (the vertex normal comes from the same
central-difference HeightSource).

## Technique (GTAO, single-bounce, no temporal)

Per pixel, inside one full-screen fragment over the LINEAR (pre-tonemap) frame:

- Identity early-out: `uAoStrength <= 0` returns `tColor` unchanged — no
  per-pixel work past the two texture fetches (byte-identical to pre-235).
- Sky skip: `depth >= 1.0 - uDepthEps` returns unchanged (matches the
  SkyPosterize / GroundMist sky-mask tolerance).
- Reconstruct view position P from depth via `uInvProjection` (THREE NDC z in
  [0,1], so the z term is `depth * 2.0 - 1.0`); read + unpack the view normal N
  (`tex.rgb * 2.0 - 1.0`).
- Project the view-space `uRadius` into screen space (perspective-correct via
  the projection diagonal + `1/|P.z|`).
- Slice loop over `uSlices` directions (constant `GTAO_MAX_SLICES` bound; the
  uniform count early-breaks, GLSL ES1-portable). Each slice rotates by a
  per-frame `uFrameIndex` dither for a cheap quality boost without TAA. Within a
  slice, a short horizon search (`GTAO_MAX_STEPS`) samples `tDepth` on both
  sides, reconstructs each sample's view position, and tracks the max elevation
  angle. The occluded arc is clamped to the normal's hemisphere and integrated
  closed-form into `ao` in [0,1] (1 = fully occluded).
- Composite toward the ambient floor (never to black):
  `visibility = mix(uAoFloor, 1.0, 1.0 - ao)` then
  `color *= mix(1.0, visibility, uAoStrength)`. The darkest a pixel gets is
  `uAoFloor * color` (the skylight base), so lit surfaces keep a skylight floor.

## Why LINEAR, before OutputPass

Unlike `SkyPosterize`/`GroundMist` (which composite post-tonemap in sRGB), the
AO pass runs BEFORE `OutputPass` and multiplies the LINEAR HDR buffer. The
multiply then passes through ACES + sRGB, giving a physically motivated falloff
and avoiding the halos a post-tonemap multiply can introduce at edges — the
"no harsh halos around edges" look target from the issue.

## Shader + pass

GLSL lives inline as `AO_VERT`/`AO_FRAG` in `src/materials/ambientOcclusionShader.ts`
(split out so the pass module stays under the 600-line cap; mirrors the
`cel.ts`/`celShader.ts` split). `AmbientOcclusionPass extends Pass`
(`src/materials/ambientOcclusion.ts`) mirrors `GroundMistPass`: constructor takes
both shared textures; public mutable `camera` rebound per view by the Renderer;
`setAo(strength, slices, floor, frameIndex)` writes the per-frame non-camera
uniforms; `render()` binds `readBuffer.texture` to `tColor` and refreshes
`uProjection`/`uInvProjection` from the camera. `needsSwap = true`.

`DEFAULT_AO_PARAMS = { radius: 0.5, floor: 0.25, slices: 4 }`. The floor
(`uAoFloor`) comes from the params (not the quality tier) so the look team
tunes the ambient base separately from the on/off + slice budget.

## Settings + tiers

User toggle: `EffectSettings.ambientOcclusion` (boolean, default ON) in
`src/core/settings.ts`, applied via `Renderer.setEffects` and exposed as a
`SettingsOverlay` row.

Quality tier (`QualityKnobs`):

- `aoStrength` — low 0 (off, identity), med 0.5, high 1.0 — mirrors the
  `groundMistStrength: 0`-on-low precedent.
- `aoSlices` — low 0, med 3, high 6 — the GLSL horizon-search slice count
  (bounded by `GTAO_MAX_SLICES = 6`).

Final shader gain: `uAoStrength = aoStrength (tier) * (enabled ? 1 : 0)`. At 0
the fragment returns `tColor` unchanged, so low tier is OFF (cheaper) and
survives the doubled cost of split-screen. Med/high ON.

## Citations

- [Render Pipeline](/data-flows/render-pipeline.md)
- [Render Layers](/conventions/render-layers.md)
- [Ground Mist](/materials/ground-mist.md)
- [Quality Propagation](/data-flows/quality-propagation.md)
- [Art Direction](/conventions/art-direction.md)
