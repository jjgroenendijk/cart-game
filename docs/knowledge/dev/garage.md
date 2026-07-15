---
type: Subsystem
title: Garage Viewer
description: Dev kart viewer with orbit, real measurements, and a runtime reference overlay.
tags: [dev, kart, debug, agent-tooling]
timestamp: 2026-07-15T00:00:00Z
---

# Garage Viewer

A dev-only screen to inspect any kart chassis + paint in isolation: orbit/zoom/
pan the model, read its real measured dimensions, and overlay a user-supplied
reference image for visual proportion comparison. Lives in `src/dev/Garage.ts`;
reached via the `?garage` dev URL flag (main.ts wires the route and owns mount/
dispose). `createGarage(container)` returns null where WebGL is unavailable
(jsdom), mirroring `src/ui/KartPreview.ts`, so tests and headless runs keep
working.

## Reuse

- Render setup copies the proven KartPreview pattern: a private
  `WebGLRenderer` + `EffectComposer` (RenderPass -> OutputPass, ACES/sRGB) and
  the `applyStudioLight` fixed-studio-light override on cel materials. The shared
  `lightUniforms` track the day cycle, which would light the isolated kart from
  arbitrary directions, so the garage overrides them with fixed studio values.
- The kart mesh is the racing mesh: `buildKartVisual` / `disposeKartVisual` from
  `src/kart/kartVisual.ts`, enumerated across `KART_VARIANTS`
  (`src/kart/kartVariants.ts`) and `KART_COLORWAYS` (`src/kart/kartColorways.ts`)
  for free switching.
- Measurements come from `measureKart` in `src/kart/models/measure.ts`; the
  panel formats them via `formatDimensions` in `src/dev/garageMeasure.ts`.
- Orbit camera uses the vendored `OrbitControls` addon; the bounds box uses
  `THREE.Box3Helper`, the ground grid uses `THREE.GridHelper`.

## Reference overlay + scale calibration

The user loads a reference image via a file input or by dragging it onto the
viewport. It is layered as an `<img>` over the canvas with an opacity slider.
Calibration: the user enters the reference image's known real-world width in
meters; `pixelsPerMeter(refPixelWidth, realMeters)` in `src/dev/garageMeasure.ts`
computes the scale, and `metersToRefPixels(kartLength, scale)` sizes an on-screen
ruler to the kart's measured length so proportions can be compared against the
reference. Non-positive input yields a 0 scale ("not calibrated"), which hides
the ruler instead of dividing by zero.

Reference images are strictly runtime-only: loaded with
`URL.createObjectURL` and revoked on replace and on dispose. Nothing is written
to disk or committed — the repo bans committed media/binary assets.

## Lifecycle

`dispose()` stops the RAF loop, removes window/viewport/img listeners, revokes
any live object URL, frees GL resources (renderer, composer, controls, grid + box
helper geometry, and the kart via `disposeKartVisual`), and detaches the DOM.

## Testing

`src/dev/Garage.test.ts` runs under jsdom: it asserts `formatDimensions` output
shape and 2-decimal rounding, `pixelsPerMeter` / `metersToRefPixels` math
(including the non-positive guard), and that `createGarage` returns null without
throwing when no WebGL context exists.
