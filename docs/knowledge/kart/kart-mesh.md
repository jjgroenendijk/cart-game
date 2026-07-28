---
type: Subsystem
title: Kart Mesh
description: Procedural kart mesh, per-variant chassis models, visual sync, cameras, LOD, grid.
tags: [kart, mesh, models, camera, lod]
timestamp: 2026-07-17T00:00:00Z
---

# Schema

Kart (Kart.ts) drives the wheel rigs (steer/spin/suspension) and visual sync
from physics bodies. The full visual — chassis plus wheel rigs — is built by
`buildKartVisual(group, model, colors)` in `src/kart/kartVisual.ts`, shared
by Kart and the kart-select preview so the preview shows exactly the mesh
that races. `disposeKartVisual(group)` is the matching resource disposer.

## Model registry

Each selectable kart lives in its own file under `src/kart/models/` as one
`KartModelDef`: id, display name, stock colorway, `KartTuning`,
`KartSilhouette`, wheel stance, and the chassis `build(ctx)` fn.
`src/kart/models/index.ts` is the registry (`KART_MODELS`, `modelById`,
`wheelOffsetsFor`, `buildKartBody`); registry order is display order.
Adding a kart = new def file + one id in the `KartVariantId` union
(`src/kart/models/types.ts`) + one entry in `KART_MODELS`. Everything else
(derived `KART_VARIANTS`, select overlay, rival assignment, preview)
follows from the registry.

## Chassis models

`buildKartBody(model, ctx)` dispatches on `KartVariantId` to one of six
distinct procedural builders (cel primitives only, no assets):

| model    | read                                                            |
| -------- | --------------------------------------------------------------- |
| balanced | rounded go-kart: pebble hull, soft snout, side pods, spoiler    |
| speed    | formula rocket: capsule fuselage, cone nose, canopy, high wing  |
| grip     | wide muscle: squashed hull, fender bulges, splitter, ducktail   |
| heavy    | mini-truck: rounded cab + dome roof, open bed, bull bar, stacks |
| feather  | dune bug: capsule spine, tube frame, torus roll hoop, pennant   |
| trail    | off-roader: tall round body, fender arches, snorkel, spare      |

Silhouettes lean on curved primitives (scaled spheres, capsules,
cylinders, cones, torii) over boxes — the painterly soft read; a test
asserts rounded geometry dominates every model. The shared part
vocabulary lives in `src/kart/models/parts.ts`: `volume`/`detail` (LOD
tiers), `blob` (scaled-sphere hull), `capsule`/`orient` (axis-aligned
tubes), and `driver` (seat, torso, accent helmet + visor, steering
wheel — shared by every model).

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
ChaseCamera spring-arms: a generic physics ray toward the desired pose is
clamped along the ray by the pure `clampCameraDistance` helper
(`src/kart/clampCameraDistance.ts`) so the cam never sits inside terrain or
big props. KartGrid positions karts for race start. Columns spread laterally across
[-1, 1] of the `lateral` half-offset mapped to the column index (2-column
straddle is the default); rows step backwards by `longitudinalGap`.
Defaults keep the field airy — 4.5 m row gap, 2.6 m lateral half-offset
(~4.5 m nearest-neighbor spacing) — FieldBuilder clamps the straddle to
the local start-zone width minus edge clearance.

kartLod handles distance LOD: full < 25 m, reduced 25-70 m, minimal >
70 m (hysteresis 5 m). Renderer applies per renderViews.

kartVariants provides 6 archetypes with full `KartTuning` physics
overrides, `StatBars`, and `KartSilhouette`. See
[Kart Variants](/kart/kart-variants.md).

## Part tiers

Kart parts split into two LOD tiers, encoded by the `volume`/`detail` helpers
in `src/kart/models/parts.ts`. Primary `volume`s cast shadows and survive LOD
reduction; small garnish (struts, rails, lamps, posts) built via `detail` has
`userData.kartDetail = true` so kartLod hides it at distance. Parts carry no
outline of their own — the realism art direction dropped the black
inverted-hull silhouette shells that primary volumes used to render.

## Disposal

`Kart.dispose()` delegates to `disposeKartVisual(group)`: disposes the unique
geometries + materials across the chassis and wheels. The Rapier body is NOT
owned here — FieldBuilder removes it from the world and then calls
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
