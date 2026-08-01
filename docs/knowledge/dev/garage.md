---
type: Subsystem
title: Garage Viewer
description: Dev kart viewer with configurable to-scale views, dimension overlay, and an agent API.
tags: [dev, kart, debug, agent-tooling]
timestamp: 2026-07-17T08:00:00Z
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

## Configurable views

The interactive viewport shows ONE angle at a time; an agent selects a single
(`?view=`) or many (`?views=` -> contact sheet) purely via URL config. A view
token is either a named preset or an arbitrary `az<deg>el<deg>[o]` orbit, both
resolved by `resolveView(token): ViewSpec | null` in the pure
`src/dev/garageViews.ts` (`GarageView` is a resolved view id; `resolveView` is
the single validation choke point). A `ViewSpec` carries azimuth, elevation,
`ortho` (projection), `govern` (metric governing dim, null = qualitative), and
`axis` (which overlay dimension set, null = none).

Presets (`VIEW_PRESETS`, listed in the panel dropdown via `PRESET_VIEWS`):

| token   | azimuth | elevation | projection  | governs | overlay axis |
| ------- | ------: | --------: | ----------- | ------- | ------------ |
| front   |    0deg |      0deg | ortho       | width   | front        |
| side    |   90deg |      0deg | ortho       | length  | side         |
| top     |    0deg |     90deg | ortho       | width   | top          |
| rear    |  180deg |      0deg | ortho       | width   | front        |
| iso     |   35deg |     25deg | perspective | —       | —            |
| reariso |  215deg |     25deg | perspective | —       | —            |

Arbitrary tokens: `az30el15` (perspective), `az45el-10o` (`o` suffix = ortho);
degrees, negatives allowed, elevation clamped to +/-89deg. Arbitrary angles are
never metric (`govern:null`, no dimension overlay) — same contract as iso.

The four axis-aligned ortho presets frame via an OrthographicCamera aimed at the
bounds center, so the render is true-to-scale and the meters -> pixels map is
deterministic: `pixelsPerMeter = canvasHeightPx / frustumHeightMeters` (uniform
on both axes). front looks along -Z (X horizontal, Y vertical), side along -X (Z
horizontal, Y vertical), top down -Y (X horizontal, Z vertical), rear along +Z.
Perspective views (iso/reariso/arbitrary) use a PerspectiveCamera framed to the
bounds sphere with OrbitControls enabled; arbitrary ortho orbits size the
frustum from `projectedExtents` (the bounds projected onto the camera plane).
Framing math is pure and unit-tested: `orthoFraming`/`frameExtents`,
`projectedExtents`, `orbitEye`/`orbitUp`, `isoFraming`, `boundsCenter`,
`planeExtents`. The front/side/top/iso cameras are byte-identical to the
pre-change legacy (only rear + arbitrary route through the general path).

## Dimension overlay

An absolutely-positioned SVG layer over the canvas (inside `gc-garage`, so a
root screenshot captures it) draws burned-in annotations for ortho views. The
pure `src/dev/garageOverlay.ts` `buildOverlay(view, dims, pixelsPerMeter,
viewport)` returns primitives (grid lines, labeled dimension lines with end
caps, a 1 m scale bar) in pixel coordinates; `src/dev/garageSvg.ts`
(`renderOverlayInto`) draws them as crisp SVG with a dark halo so labels read on
any background. Each ortho view shows a 0.5 m
metric grid, a scale bar, and labeled dimension lines: front -> width + height +
track; side -> length + height + wheelbase; top -> width + length + track +
wheelbase. Because the kart is centered and pixelsPerMeter is exact, every
metric maps to `center +/- value/2 * pixelsPerMeter`. `buildOverlay` keys on the
resolved spec's `axis`, so rear reuses the front dimension set (width/height/
track). Perspective and arbitrary-orbit views (axis null) draw no 2D dimension
lines; they rely on the 3D grid + `THREE.Box3Helper` + DOM panel.

## Imperative API + snapshot

`GarageHandle` extends the human UI with a headless-drivable API: `setStyle(
variant, colorway?)` rebuilds the kart + measurements + overlay; `setView(view)`
switches camera + overlay; `setGrid(on)` toggles the 3D + SVG grid;
`setReference(dataUrl | null, realMeters?)` injects a reference image headlessly
(null clears); `snapshot()` returns `GarageSnapshot`; `dispose()` tears down.
`setStyle`/`setView`/`setReference` each render at least one frame synchronously,
so a screenshot taken immediately is correct even while the RAF loop (which only
drives iso orbit) is idle. Unknown variant/colorway/view args are ignored. The
left DOM control panel (selects, toggles, dimension readout) is built by
`src/dev/garagePanel.ts` (`buildGaragePanel`), which wires listeners to Garage
callbacks and returns the elements Garage keeps mutating; it,
`garageSvg.ts`, and `garageDom.ts` (`buildGarageChrome` — the WebGLRenderer
try/catch + DOM root + scene graph, returning null without WebGL so
createGarage's null guard holds; plus the `applyStudioLight` fixed light)
are jsdom-safe (no THREE/WebGL) or scoped to GL construction, and keep
`Garage.ts` under the hand-written line cap.

`GarageSnapshot = { variant, colorway, view, dimensions: KartDimensions,
pixelsPerMeter: number | null, viewport: { w, h } }`. `pixelsPerMeter` is null on
perspective views (iso/reariso/arbitrary). Measurements come from `measureKart` in
`src/kart/models/measure.ts`; the panel formats them via `formatDimensions` in
`src/dev/garageMeasure.ts` (which also exports `formatMeters`).

For compare mode the handle adds three methods: `setReferenceSheet(dataUrl |
null)` decodes (async) a 2x2 reference sheet and stores it; `setRealDims(real,
govern?)` sets the agent-searched real-world car dims (meters) plus an optional
per-view governing-dim override; and `compareSheet(views?)` returns
`Promise<{ dataUrl, views }>` — a single contact-sheet PNG plus per-view
`{ pixelsPerMeter, metric, governMeters, stats }`, where `stats` is the
`modelOnlyPct`/`refOnlyPct`/`iou`/`coverage` mismatch summary. The canvas/WebGL
work lives in `src/dev/garageCompare.ts` (`runCompare`), which renders each view
as a flat white-on-black silhouette, keys the matching reference quadrant,
aligns + classifies the difference, and blits shaded model + diff overlay +
label into the sheet. Renders at a fixed cell with `pixelRatio` 1 so the
silhouette pixels match the exact px/m space, and reads pixels via drawImage of
the GL canvas (the renderer sets `preserveDrawingBuffer`). Passing `split: true`
(URL `?split`) swaps the per-view overlay for a side-by-side layout — a shaded
model cell beside the keyed, to-scale reference cell, one view per row — while
computing the same masks + `stats`.

## URL params

On creation the garage reads `location.search` for `variant`, `colorway`,
`view`, and `grid` (grid defaults on) and applies them as initial state, so
`?garage&variant=speed&view=side` works for a human too. `view` accepts any view
token (preset or `az..el..` orbit) via `resolveView`; unknown values fall back
to iso. Compare mode adds `compare` (presence enables it and shows the composite
sheet over the canvas), `split` (side-by-side model|reference cells instead of
the diff overlay), `views` (a CSV like `front,rear,az30el15` selecting the sheet
panels; invalid tokens dropped, empty -> the canonical four),
`length`/`width`/`height` (positive meters, the real car dims), `govern` (a map
like `top=length,front=width` overriding the per-view governing dimension), and
`refgrid` (a reference-image layout like `front,side/top,rear` — `/` rows, `,`
cells — overriding the default 2x2; unmapped views get no reference). In compare
mode a file-input / drag-dropped image is treated as the reference sheet and
re-runs the comparison.

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

## Compare geometry (pure modules)

The compare mode — overlaying a supplied reference car image against the model
and highlighting where their contours differ — is backed by four WebGL-free,
jsdom-tested modules so the pixel/layout math stays testable and `Garage.ts`
only holds canvas glue. `src/dev/garageMask.ts` thresholds a raw RGBA buffer to
a 1-bit silhouette (`luminanceMask` for the flat white-on-black model render,
`estimateBackground` + `backgroundMask` for the reference photo), then
`classifyDiff` labels each pixel overlap / model-only / ref-only, `diffStats`
summarizes it (percent-of-union mismatch + IoU + coverage), and `paintDiff`
tints it (cyan = model past reference, magenta = reference past model, gray =
agreement). `src/dev/garageQuadrant.ts` slices the reference into per-view source
rects: `cellRect` handles an arbitrary R x C grid, `quadrantRect` is the default
2x2 (front TL, side TR, iso BL, top BR), and `parseRefGrid` reads a custom
`front,side/top,rear` layout so extra angles (e.g. rear) can be referenced too.
`src/dev/garageRefScale.ts` places a reference silhouette into the model's pixel
grid, keyed on the resolved spec: metric ortho views (front/side/top/rear) scale
so one governing real dimension matches the model true-to-scale — front/side/rear
ground-align, top centers — while perspective/arbitrary views are a proportional
bbox-fit (`metric:false`, qualitative). `src/dev/garageContactSheet.ts` lays the
selected views into one composite grid (only the canonical four-view set mirrors
the reference 2x2; other sets tile row-major).

## Testing

`src/dev/garageViews.test.ts` and `src/dev/garageOverlay.test.ts` run under
jsdom: they assert `resolveView` token parsing (presets, arbitrary orbits,
elevation clamp, junk), that `projectedExtents` reproduces `planeExtents` for the
axis-aligned presets, `orthoFraming` pixels-per-meter + frustum framing, and that
`buildOverlay` dimension-line endpoints + labels land at the expected pixels
(rear reuses the front set; perspective/arbitrary yield none).
`src/dev/garageQuadrant.test.ts` covers `cellRect` grids + `parseRefGrid`.
`src/dev/Garage.test.ts` asserts the `garageMeasure` helpers and that
`createGarage` returns null without throwing when no WebGL context exists.
`src/dev/garageMask.test.ts` covers mask threshold/keying + diff counts, stats,
and paint. `src/dev/garageContactSheet.test.ts` covers contact-sheet layout
(1/2/4 views) + `parseViews`. `src/dev/garageRefScale.test.ts` covers the
governing dim, placement scale, and resample.
