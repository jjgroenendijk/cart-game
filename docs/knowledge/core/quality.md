---
type: System
title: Quality
description: Quality tiers mapping budgets to pixel ratio, near + optional far cascade shadows, VFX.
tags: [core, performance, quality]
timestamp: 2026-08-02T03:30:00Z
---

# Quality

Maps quality tiers (`QualityTier = "low" | "med" | "high"`, default high) to
knobs: pixelRatio, per-cascade shadow extents (near + optional far), VFX
budgets, and the draw-distance / LOD budgets.

## User control

The tier is user-facing: `SettingsState` (`src/core/settings.ts`) carries a
`quality` field (`"low" | "med" | "high"`, default `"high"`), coerced by
`validateSettings` and persisted by `src/core/storage.ts` with no schema bump
(old v1 stores default the field). The SettingsOverlay GRAPHICS row cycles it;
it applies live via `Game.setQuality` (`src/core/Game.ts`) — renderer + field +
env update immediately, while the tier-gated terrain/dressing stream radii +
seed budget re-apply on the next `buildWorld`. `GameFlow.applySettings`
(`src/core/GameFlow.ts`) calls `host.setQuality(s.quality)` on boot and on every
settings change.

## Schema

| Tier | pixelRatio       | shadowMap | far | half | VFX  | Skid | glint | grade |
| ---- | ---------------- | --------- | --- | ---- | ---- | ---- | ----- | ----- |
| low  | 1                | 1024      | 120 | 60   | 512  | 256  | 0     | 1     |
| med  | 1.5              | 2048      | 200 | 40   | 1536 | 512  | 1     | 1     |
| high | Math.min(dpr, 2) | 2048      | 400 | 40   | 3072 | 1024 | 1     | 1     |

`half` (`shadowHalfExtent`) is the NEAR cascade ortho half-extent; #144
tightened med/high to 40 m (was 80 m) since a far 200 m cascade now covers the
middle distance. Low stays 60 m. Far (2nd) cascade extents (all 0 on low):

| Tier | farMap | farHalf | farFar | split | blend |
| ---- | ------ | ------- | ------ | ----- | ----- |
| low  | 0      | 0       | 0      | 0     | 0     |
| med  | 1024   | 200     | 400    | 40    | 8     |
| high | 2048   | 200     | 400    | 40    | 8     |

Low tier = far cascade OFF = single near box, byte-identical to pre-144.
Med/high add a 200 m far cascade selected by view distance with an 8 m blend
band (`cascadeSplit` / `cascadeBlendWidth`; pure `cascadeBlendWeight` in
`core/shadowCascade.ts`, mirrored in the cel shader).

232 SMAA edge anti-aliasing (`smaa: true`) is on for every tier — the
EffectComposer path gets no benefit from the context `antialias:true` MSAA, so
SMAA is the pipeline's only edge AA. See
[Anti-aliasing](/materials/anti-aliasing.md).

## Selective HDR bloom

Scene-wide threshold bloom is retired (#310): the raw sky dome and ordinary pale
surfaces both exceed scene-linear 1.0, so a bright pass washes the frame white.
Bloom is now SELECTIVE — `EmissiveCapturePass` (`src/materials/emissiveCapture.ts`)
renders only the dedicated emitter layer (layer 3) into a black-cleared HalfFloat
RT, `BloomPass` (`src/materials/bloom.ts`) blurs it (UnrealBloomPass, threshold 0)
and composites the pure bloom over the LINEAR pre-tonemap buffer before
OutputPass. Only genuine emitters bleed: the sun disc (same-mesh dual-layer) and,
since #315, snow sparkle + water glint (layer-3 sibling clones with
`EMISSIVE_OUTPUT` material variants — see
[Render Layers](/conventions/render-layers.md)).

| Tier | bloomStrength | bloomHalfRes |
| ---- | ------------- | ------------ |
| low  | 0             | false        |
| med  | 0.35          | true         |
| high | 0.5           | false        |

Low tier omits the bloom passes (`BloomPass.enabled` false -> byte-identical +
free). med renders the blur at half resolution, high at full. The user toggle
`effects.bloom` (`src/core/settings.ts`) additionally flips both passes'
`.enabled`. The analytic sun halo was retired in favour of this bloom; god rays +
lens flare remain with strengths `godRayStrength` / `lensFlareStrength` (non-zero
on every tier, <= 0.5).

`DEFAULT_QUALITY = "high"`. Column abbreviations: `shadowMap` = `shadowMapSize`;
`far` = `shadowCameraFar`; `half` = `shadowHalfExtent` (NEAR cascade); `VFX` =
`vfxParticleBudget`; `Skid` = `skidSegments`; `glint` = `waterGlintIntensity`
(0 disables on low); `grade` = `postGradeStrength` (1 = full look on every
tier; near-free ALU). Far-cascade columns: `farMap` = `farShadowMapSize`,
`farHalf` = `farShadowHalfExtent`, `farFar` = `farShadowCameraFar`, `split` =
`cascadeSplit`, `blend` = `cascadeBlendWidth`. `Renderer.setQuality` applies +
rebuilds shadow map.
`FieldBuilder.setQuality(tier)` and `Game.setQuality(tier)` forward tier
changes through the system. Domain modules (kartVfx.ts, skidMarks.ts) export
matching copies (`VFX_BUDGET`, `SKID_SEGMENTS`) kept in sync by comment so
GL owners stay decoupled from core. See
[quality-propagation](/data-flows/quality-propagation.md).

## Draw-distance / LOD budgets

The distant-rendering toolkit (terrain streaming, LOD cross-fade, incremental
chunk seed, far-decor density falloff) is tier-gated so LOW stays within its
current budget while HIGH — the default — reaches farther:

| Tier | drawCap | seedBudget | crossFade | densityMin | backdropReach |
| ---- | ------- | ---------- | --------- | ---------- | ------------- |
| low  | 200     | 8          | 0         | 0.25       | 0             |
| med  | 280     | 12         | 0.4       | 0.30       | 0             |
| high | 360     | 16         | 0.4       | 0.35       | 0             |

`drawCap` (`terrainDrawCap`) is the max world-scaled terrain + dressing stream
radius in metres; the pure `resolveStreamPlan(knobs, worldSize)` helper clamps
the world-sized stream radius to `[140, drawCap]` (cull `+30`) so LOW streams a
nearer fog horizon than HIGH, and derives the backdrop ring (below). It returns
`{streamRadius, cullRadius, backdrop?}`; `Game.buildWorld` spreads that into the
`Terrain` + dressing options.
`seedBudget` (`terrainSeedBudget`) caps chunks activated per frame during the
incremental ctor seed. `crossFade` (`terrainCrossFadeSeconds`) is the LOD
tier-swap dither duration; LOW is 0 (instant snap, no transient double draw —
consistent with `TerrainChunkManager` gating the fade off on low). `densityMin`
(`dressingDensityMin`) is the far-decor density floor; LOW thins distant
scatter hardest. `backdropReach` (`terrainBackdropReach`) is the HLOD backdrop
ring reach in metres past the cull radius (`resolveStreamPlan` sets the backdrop
inner `= cullRadius`, outer `= cullRadius + reach`). It ships at 0 on EVERY tier:
the ring read as dark near-horizon "mountains" instead of receding haze, so the
far horizon falls back to the plain fog wall. The `TerrainBackdrop` code stays
dormant (opt-in) until the look is retuned. HIGH reproduces the pre-tier-gate
fixed draw/seed/crossFade/density constants exactly, so the default tier does
not regress. `Game.buildWorld` resolves these from
`qualityKnobs(qualityTier, dpr)` at each world (re)build; `setQuality` records
the tier so the next rebuild picks it up. Collider radius (`COLLIDER_RADIUS` /
`COLLIDER_CULL_RADIUS` = 140/170) stays tier-independent — physics safety: karts
need ground + prop colliders around them at every tier. The per-frame collider
foci pool (all kart positions, humans then rivals) is filled by the pure
`fillKartFoci` helper (`core/colliderFoci.ts`) into a reused `Pt[]`.

## Citations

- [Renderer](/core/renderer.md)
- [VFX](/kart/vfx.md)
- [SkidMarks](/kart/skid-marks.md)
- [Quality Propagation](/data-flows/quality-propagation.md)
