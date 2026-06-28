# 039 Composer mask depth share

Status: open (concept - to be refined)

## Context

Split from 022 (perf pass), Phase 2.1. Per rendered view the composer runs
RenderPass -> PostOutlinePass -> OutputPass -> SkyPosterizePass
(`Renderer.ts`). PostOutline (`materials/postOutline.ts`) + SkyPosterize
(`materials/skyPosterize.ts`) each RE-RENDER the full scene into private
RTs before their fullscreen composite. 2P split-screen = ~6 scene renders
plus 1 shadow/frame. The intended win: share a sampleable DepthTexture so the
mask passes READ existing depth instead of re-rasterizing.

Phase 2.1 was deferred because the masks are NOT depth-equivalent:

- PostOutline renders **layer 1 only** with an override material that
  outputs view-space NORMALS (packed 0.5\*n+0.5) into color + a layer-1-only
  depth. The Sobel composite needs both normals + depth; the `depth>=0.999`
  early-out excludes non-terrain. Sharing all-layers depth breaks this.
- SkyPosterize renders layers 0+1 depth-only but FORCES transparent objects
  (Weather particles, DynamicSky moon/stars) to write depth so they occlude
  the sky mask and keep their color (documented design intent, Weather.ts
  - DynamicSky.ts). The main RenderPass has depthWrite:false on those ->
    sharing main depth makes weather receive the sky gradient = visible
    regression.

## Goal

Cut 1-2 full scene renders/view while keeping outline + sky-post output
bit-identical. Needs either: a rework that produces the layer-specific data
from a shared buffer, OR an art call (should weather receive the sky
gradient?) that lets the pre-pass be dropped.

## Needs refinement

- PostOutline: is there a single-pass that emits layer-1 normals + the
  shared depth in one render (MRT / packed)? Or keep its private render but
  feed it the shared depth so the early-out matches.
- SkyPosterize: art decision on weather/moon through the sky mask. If weather
  SHOULD receive the gradient, drop the pre-pass + share depth. If not, the
  pre-pass stays.
- Verify bit-identity via a render-output parity test + dev-server visual
  diff (acceptance bar in 022).
- three r0.184 DepthTexture + WebGLRenderTarget sharing mechanics.

## Depends on

001/002 (cel + post; mask contract). 008 (split-screen; 2P gains ~2x 1P).
010 (weather + dynamic sky; the transparent-depth design intent). 022
(this is the measured follow-on; 022 landed every safe win).
