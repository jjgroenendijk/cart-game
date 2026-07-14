---
type: Subsystem
title: Snow Tracks
description: Living depth-profiled snow tire tracks as a shaded berm/channel strip on layer 0.
tags: [kart, snow-tracks, shader, weather]
timestamp: 2026-07-14T00:00:00Z
---

# Schema

Depth-profiled snow tire tracks as a terrain-conformed cross-section strip on
layer 0. Each rear-wheel segment is a groove: a shadowed CENTER channel flanked
by two raised OUTER berms of displaced snow. Depth reads from shading + berm
relief -> the terrain mesh + collider are UNTOUCHED (shading, not ground
displacement).

Render layer: layer 0 (kart/prop space), NOT the terrain layer 1. Skid marks
live on layer 1 because they are FLAT (no normal/depth edge for the layer-1
Sobel toon-outline pass, `src/materials/postOutline.ts`, to catch). Snow tracks
carry raised berms + outward-tilted normals, which that Sobel pass would trace
as a hard black cartoon edge around every track. Layer 0 renders them in the
same color pass (one shared depth buffer, so they still occlude against terrain
and karts via polygonOffset) but stays out of the layer-1-only outline capture,
so no outline is traced. Removing the game's other black outlines is tracked
separately.

Append while onSnow + rear-grounded + not in water + moved >= `TRACK_MIN_STEP`.
polygonOffset + depthWrite:false keep the relief flat on the road without
z-fighting.

## Architecture

`src/kart/snowTracks.ts` is pure (no THREE): ring buffer, the append predicate,
the 6-vertex profile builder, the onSnow predicate, and the fade math.
`src/kart/SnowTracksLayer.ts` (`export class SnowTracks`) is the GL owner: ONE
`THREE.Mesh` holding all karts' segments in a ring, terrain-conformed bake at
append time, partial GPU uploads, age-fade fragment.

`src/core/FieldBuilder.ts` constructs it beside `this.skid`, adds `.group` to
the scene, calls `update(dt, time, samples, terrain)` in `updateVfx`, and resizes
it in `setQuality`. It reuses the pooled `KartVfxSample` slots (rear-wheel world
pos + grounded + inWater + surfaceTint) -> no new plumbing.

## Profile relief

Per segment, 6 rails: prev + curr rows of (left berm, center channel, right
berm). Berms sit at +/- `TRACK_HALF_WIDTH` with `TRACK_BERM_LIFT`; the channel
sits on the wheel line with the smaller `TRACK_CHANNEL_LIFT`. Both lifts stay
at/above the surface so terrain never occludes the groove. The GL owner adds
`terrain.heightAt` + a normal offset on top of the lift.

Genuine relief comes from shading, read from the shared `lightUniforms`:

- vertex colors: bright cool-white berms, a subtly darker cool-grey channel ->
  the channel reads as pressed snow, not a painted stripe (relief comes from the
  tilted berm normals, so the channel fill stays low-contrast).
- per-vertex world normals: berm normals lean OUTWARD along the lateral right
  vector -> one ridge side catches the sun (`dot(N, uSunDirWorld)`), the other
  shades -> directional relief. The channel keeps the terrain normal.
- optional cheap hash sparkle on lit berm edges only (`uSparkle`, gated by the
  `berm` attribute).

## onSnow trigger

`trackOnSnow(cover, r, g, b)` -> true when the eased shared `snowUniform`
`uSnowCover` exceeds `TRACK_SNOW_THRESHOLD` (snowy weather anywhere) OR the
rear-wheel `surfaceTint` is near-white + desaturated (tundra ground even under a
clear sky). The eased cover is the shared channel Environment writes; SnowTracks
only reads it by reference.

## Living fade

The fade uniform is driven each frame by `trackFadeTime(TRACK_FADE_TIME, cover)`:
the eased `uSnowCover` proxies snowfall rate, so tracks fade FAST while it snows
hard (fresh snow refills the grooves) and stay long (`TRACK_FADE_TIME`) on
calm/tundra ground, floored at `TRACK_MIN_FADE`.

This is a bounded fade-RING, NOT paint-persistent-until-melt: there is no
terrain-paint RenderTarget. Oldest segments recycle on ring wrap; the fragment
discards once age exceeds the live fade time.

## Quality Tiers

Larger than skid marks (tracks are continuous, laid every step on snow):

| Tier   | Segment Budget |
| ------ | -------------- |
| Low    | 512            |
| Medium | 1024           |
| High   | 2048           |

Same filename-split rationale as VFX / skid marks (case-insensitive FS).

# Citations

- [Skid Marks](/kart/skid-marks.md)
- [VFX](/kart/vfx.md)
- [Quality](/core/quality.md)
