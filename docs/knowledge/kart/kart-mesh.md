---
type: Subsystem
title: Kart Mesh
description: Procedural kart mesh, per-variant chassis models, visual sync, cameras, LOD, grid.
tags: [kart, mesh, models, camera, lod]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

Kart (Kart.ts) owns the wheel rigs (steer/spin/suspension) and visual sync
from physics bodies. The chassis — everything above the axles — is built by
a per-variant model builder in `src/kart/kartModels.ts`.

## Chassis models

`buildKartBody(model, ctx)` dispatches on `KartVariantId` to one of six
distinct procedural builders (cel primitives only, no assets):

| model    | read                                                         |
| -------- | ------------------------------------------------------------ |
| balanced | classic go-kart: box chassis, nose wedge, spoiler + wings    |
| speed    | formula: slim hull, cone nose, side pods, strutted rear wing |
| grip     | wide low racer: splitter blade, side skirts, ducktail        |
| heavy    | mini-truck: bed + cab + roof, bull bar, exhaust stacks       |
| feather  | open buggy: narrow spine, exposed rails, roll hoop, pennant  |
| trail    | off-roader: raised body, fenders, roof rack, spare wheel     |

`KartBodyCtx` carries the group, the three shared cel materials (body,
accent, dark), and the variant's `KartSilhouette`; builders take materials
from the caller so a colorway repaint never touches geometry.

`wheelOffsetsFor(model)` returns the per-model wheel stance (4 local
offsets; y fixed at -0.35 because `Kart.sync` suspension bounce hardcodes
that base). The Kart instance stores its stance and `wheelWorldPos` reads
it, so kart action VFX (053) track the visible wheels of every model. The
`Kart` constructor takes a `KartStyle` (`{ model?, colors? }`); both
default to the balanced variant's stock look.

ChaseCamera provides third-person chase view. MenuCamera handles menu scene.
KartGrid positions karts for race start. Columns spread laterally across
[-1, 1] of the `lateral` half-offset mapped to the column index (2-column
straddle is the default); rows step backwards by `longitudinalGap`.

kartLod handles distance LOD: full < 25 m, reduced 25-70 m, minimal >
70 m (hysteresis 5 m). Renderer applies per renderViews.

kartVariants provides 6 archetypes with full `KartTuning` physics
overrides, `StatBars`, and `KartSilhouette`. See
[Kart Variants](/kart/kart-variants.md).

## Outline rendering

All kart parts use the inverted-hull outline technique from `materials/outline.ts`.
`addOutline(mesh, thickness)` attaches a BackSide child mesh that expands along
view-space normals, producing a constant-screen-space toon rim.

Two thickness tiers in NDC units (exported from `src/kart/kartModels.ts`):

| Constant         | Value (NDC) | Applied to                           |
| ---------------- | ----------- | ------------------------------------ |
| `BODY_OUTLINE`   | 0.005       | Primary hull volumes (chassis, nose) |
| `DETAIL_OUTLINE` | 0.004       | Seat, driver, spoilers, pods, wheels |

Small garnish (struts, rails, lamps, posts) has `userData.kartDetail = true`
for LOD but no outline of its own — the `volume`/`detail` helpers in
kartModels encode this convention for every model.
Outline meshes use `renderOrder = -1` so the parent mesh overdraws the interior,
avoiding z-fighting on coplanar parts.

## Disposal

`Kart.dispose()` frees GL resources: detaches every inverted-hull outline
(disposes its unique InvertedHullMaterial) and disposes the unique
geometries + materials across the chassis and wheels. The Rapier body is
NOT owned here — FieldBuilder removes it from the world and then calls
`kart.dispose()` for every human + rival on field teardown.

## Menu Camera

`src/kart/MenuCamera.ts` is a cinematic high-orbit camera for the title
screen. It slowly yaws around a fixed scenic track point at a large
radius + altitude so the world sweeps under a high cam. An all-layers
`PerspectiveCamera` — it sees the solid (0), terrain (1), and sky (2)
layers. The target is sampled once (by Game, from
`SplineTrack.getPoint` at construction) and passed in; MenuCamera never
touches the spline per frame. A separate camera object from
ChaseCamera keeps `ChaseCamera.initialized` false until the first
racing frame, so it snaps to the kart on race start.

# Citations

- [KartController](/kart/controller.md)
- [PlayerView](/core/player-view.md)
- [Quality](/core/quality.md)
- [CelMaterial](/materials/cel-material.md)
