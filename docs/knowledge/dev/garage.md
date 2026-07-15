---
type: Subsystem
title: Garage Viewer
description: Dev kart viewer with named to-scale views, dimension overlay, and an agent API.
tags: [dev, kart, debug, agent-tooling]
timestamp: 2026-07-15T00:00:00Z
---

# Garage Viewer

A dev-only screen to inspect any kart chassis + paint in isolation and read its
real measured dimensions from to-scale renders. It is the inspection surface the
shoot harness drives: a vision-capable agent captures named views + burned-in
dimensions, reads them, edits the kart model def, and re-captures. Lives in
`src/dev/Garage.ts`; reached via the `?garage` dev URL flag (main.ts wires the
route and owns mount/dispose). `createGarage(container)` returns null where WebGL
is unavailable (jsdom), mirroring `src/ui/KartPreview.ts`, so tests and headless
runs keep working. The root element has class `gc-garage` and is the screenshot
target (canvas + SVG overlay compose inside it).

## Named views

`GarageView = "front" | "side" | "top" | "iso"`. front/side/top use an
OrthographicCamera framed to the measured bounds with a margin, so the render is
true-to-scale (no perspective distortion): front looks along -Z (X horizontal,
Y vertical), side along -X (Z length horizontal, Y vertical), top down -Y (X
width horizontal, Z length vertical). The camera aims at the bounds center, so
the kart projects centered and the meters -> pixels map is deterministic:
`pixelsPerMeter = canvasHeightPx / frustumHeightMeters` (uniform on both axes).
iso uses a PerspectiveCamera at a 3/4 angle (azimuth 35deg, elevation 25deg)
framed to bounds; OrbitControls are enabled only there (ortho views are fixed
for measurement). Framing math is the pure `src/dev/garageViews.ts`
(`orthoFraming`, `isoFraming`, `boundsCenter`, `planeExtents`), unit-tested.

## Dimension overlay

An absolutely-positioned SVG layer over the canvas (inside `gc-garage`, so a
root screenshot captures it) draws burned-in annotations for ortho views. The
pure `src/dev/garageOverlay.ts` `buildOverlay(view, dims, pixelsPerMeter,
viewport)` returns primitives (grid lines, labeled dimension lines with end
caps, a 1 m scale bar) in pixel coordinates; Garage renders them as crisp SVG
with a dark halo so labels read on any background. Each ortho view shows a 0.5 m
metric grid, a scale bar, and labeled dimension lines: front -> width + height +
track; side -> length + height + wheelbase; top -> width + length + track +
wheelbase. Because the kart is centered and pixelsPerMeter is exact, every
metric maps to `center +/- value/2 * pixelsPerMeter`. iso draws no 2D dimension
lines (perspective); it relies on the 3D grid + `THREE.Box3Helper` + DOM panel.

## Imperative API + snapshot

`GarageHandle` extends the human UI with a headless-drivable API: `setStyle(
variant, colorway?)` rebuilds the kart + measurements + overlay; `setView(view)`
switches camera + overlay; `setGrid(on)` toggles the 3D + SVG grid;
`setReference(dataUrl | null, realMeters?)` injects a reference image headlessly
(null clears); `snapshot()` returns `GarageSnapshot`; `dispose()` tears down.
`setStyle`/`setView`/`setReference` each render at least one frame synchronously,
so a screenshot taken immediately is correct even while the RAF loop (which only
drives iso orbit) is idle. Unknown variant/colorway/view args are ignored.

`GarageSnapshot = { variant, colorway, view, dimensions: KartDimensions,
pixelsPerMeter: number | null, viewport: { w, h } }`. `pixelsPerMeter` is null on
the iso (perspective) view. Measurements come from `measureKart` in
`src/kart/models/measure.ts`; the panel formats them via `formatDimensions` in
`src/dev/garageMeasure.ts` (which also exports `formatMeters`).

## URL params

On creation the garage reads `location.search` for `variant`, `colorway`,
`view`, and `grid` (grid defaults on) and applies them as initial state, so
`?garage&variant=speed&view=side` works for a human too. Values are validated
against the registries / GarageView set; unknown values are ignored.

## Reference overlay + scale calibration

The human loads a reference image via a file input or drag-drop; it layers as an
`<img>` under the SVG with an opacity slider. Calibration: the user enters the
image's known real-world width in meters; `pixelsPerMeter(refPixelWidth,
realMeters)` in `src/dev/garageMeasure.ts` computes the scale and
`metersToRefPixels(kartLength, scale)` sizes an on-screen ruler. Reference images
are strictly runtime-only: a File loads via `URL.createObjectURL` (revoked on
replace/dispose); a data URL passed to `setReference` is caller-owned and never
revoked. Nothing is written to disk or committed.

## Lifecycle

`dispose()` stops the RAF loop, removes window/viewport/img listeners, revokes
any live object URL, frees GL resources (renderer, composer, controls, grid + box
helper geometry, and the kart via `disposeKartVisual`), and detaches the DOM.

## Testing

`src/dev/garageViews.test.ts` and `src/dev/garageOverlay.test.ts` run under
jsdom: they assert `orthoFraming` pixels-per-meter + frustum framing for each
ortho view, that `buildOverlay` dimension-line endpoints + labels land at the
expected pixel coordinates and that iso yields no lines. `src/dev/Garage.test.ts`
asserts the `garageMeasure` helpers and that `createGarage` returns null without
throwing when no WebGL context exists.
