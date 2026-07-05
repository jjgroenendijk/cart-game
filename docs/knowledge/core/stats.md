---
type: Subsystem
title: Stats
description: Perf sampling, EWMA frame-time smoothing, budget classification, F3 StatsHud overlay.
tags: [core, performance, debug]
timestamp: 2026-07-05T00:00:00Z
---

# Stats

Pure performance profiling toolkit (no Three.js, no WebGL, no DOM) plus the
DOM-based `StatsHud` F3 overlay that consumes it. jsdom-testable throughout.

## PerfSample

Plain-data snapshot of a single frame:

```ts
interface PerfSample {
  frameMs: number; // EWMA-smoothed frame time
  fps: number; // 1000 / frameMs
  drawCalls: number; // renderer.info.calls
  tris: number; // renderer.info.triangles
  geometries: number; // renderer.info.geometries
  textures: number; // renderer.info.textures
  shadowCasters?: number; // optional
}
```

## Classification

`classify(sample, targets)` rates each metric against `MetricThreshold`
(warn/bad) and returns a `PerfClassification` with `MetricStatus = "ok" |
"warn" | "bad"` per key. A separate `rate(value, threshold)` helper backs
each classification. Default thresholds (`DEFAULT_BUDGET_1P`):

| Metric        | Warn    | Bad     |
| ------------- | ------- | ------- |
| frameMs       | 14 ms   | 16.6 ms |
| drawCalls     | 80      | 120     |
| shadowCasters | 40      | 80      |
| tris          | 350,000 | 500,000 |

## FrameMsEwma

Exponential weighted moving average for frame time:

- `new FrameMsEwma(alpha = 0.1)` — seeded with first value, then
  `value += (ms - value) * alpha`.
- `.push(ms)` returns the updated smoothed value.
- `.smoothed` accessor reads without pushing.
- `.reset()` clears to NaN for the next seeding cycle.

## StatsHud

Self-driving DOM overlay (`class StatsHud`). Constructor spawns an rAF loop,
builds a `PerfSample` from `RenderInfoSnapshot` (supplied by a caller
callback, plain numbers — no THREE dependency), classifies via
`DEFAULT_BUDGET_1P`, and renders a monospace multi-line readout.

```ts
interface RenderInfoSnapshot {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}
```

**Formatting** (`formatStats` — pure, unit-tested):

```text
FPS 60
FRAME 16.3 ms
CALLS 42
~TRIS 360k      // ~ = warn, ! = bad
GEO 28
TEX 34
```

- `glyph(status)`: `""` for ok, `"~"` for warn, `"!"` for bad.
- frameMs rendered to 1 decimal; tris in `k` thousands.
- FPS, GEO, TEX carry no glyph.

**Visibility**: F3 toggles. Optional `visibleWhen` predicate forces hide
(e.g. outside racing). `remove()` cancels rAF, drops keydown listener,
detaches root.

## Citations

- [Renderer](/core/renderer.md)
