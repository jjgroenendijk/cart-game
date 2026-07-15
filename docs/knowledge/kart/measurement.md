---
type: Subsystem
title: Kart Measurement
description: Derived kart dimensions (wheelbase, track, ride height, bounds) for garage + tests.
tags: [kart, debug, agent-tooling]
timestamp: 2026-07-15T00:00:00Z
---

# Kart Measurement

Dimensional measurements for a kart model, used by the dev garage viewer and by
regression tests. Lives in `src/kart/models/measure.ts`. All numbers are meters
in local kart space (origin at the chassis reference, +Z toward the rear).

## Two layers

- `deriveDimensions(model)` — pure, WebGL-free, jsdom-safe (the tested path).
  Reads only the model's `silhouette` (bodyDims, tireRadius, noseZ, spoilerH)
  and the normalized wheel `stance`. Wheelbase and track come from the extremes
  of the per-wheel offsets returned by `wheelOffsetsFor` — every model's stance
  (whether built via the `stance()` helper or a named array like `GRIP_STANCE`)
  normalizes to the same `ReadonlyArray<WheelOffset>`, so there is no per-model
  special-casing. Length/width/height are coarse silhouette proportions.
- `measureKartBox(variant)` — best-effort real-mesh bounds. Builds the racing
  visual via `buildKartVisual` into a detached group and reads a `THREE.Box3`
  off its `BufferGeometry` attributes. `setFromObject` needs no GL context, so
  this runs under node/jsdom; it returns null (guarded) if geometry is
  unavailable or the box is empty/non-finite.

`measureKart(variant)` combines them: wheelbase/track/rideHeight stay
stance-derived (exact), while length/width/height are overwritten with the true
mesh extents and `bounds` is attached when the Box3 path succeeds.

## Derivations

- `wheelbase = |maxWheelZ - minWheelZ|`
- `trackWidth = |maxWheelX - minWheelX|`
- `rideHeight = |minWheelY| + tireRadius` (ground sits a tire radius below the
  lowest wheel centre)

Coarse silhouette fallbacks: `width = max(bodyW, trackWidth)`,
`length = bodyD/2 - noseZ`, `height = rideHeight + bodyH/2 + spoilerH`. The
mesh Box3 supersedes the coarse height (driver/roof/spoiler exceed the
silhouette proportions), which is why `measureKart` prefers mesh extents.

## Testing

`src/kart/models/measure.test.ts` asserts orderings that must hold from the
registry data (heavy widest track, feather narrowest, speed longest wheelbase),
concrete anchors for `balanced`, and plausible meter ranges. The Box3 path runs
in the test env, so mesh refinement is exercised too.
