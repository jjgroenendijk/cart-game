# 014 clouds + sky decor — verify

Date: 2026-06-25. Branch `feat/014-sky-decor`. 5 atomic commits (1-4 land
impl + tests, 5 is the plan refine); gate green on each (typecheck + eslint +
vitest).

## Scope verified (unit, jsdom)

- clusterLayout: determinism, purity, puff count, XZ bounds, Y NOT bounded,
  sub-RNG stability (earlier clouds stable as count grows), large-count sanity.
- Clouds: single InstancedMesh layer 0, flat CelMaterial, no shadows, +X drift
  - wrap, density edges (0 / 0.49 / 0.5 / 2), altitude>cloudHeight precedence,
    tint round-trip (dusk shift -> day restore), first-update helper match.
- cloudTint: per-phase blend (dawn/dusk/day/night), purity, determinism, all
  four phases finite (switch coverage).
- SunDisc: layer 0, renderOrder -1, additive fog:false material, default
  geometry/color match moon, position magnitude exactly SUN_SHELL for a unit
  dir, custom radius unaffected positioning, opacity exact 1-nightFactor +
  unclamped outside [0,1], visibility pop, dispose idempotent.
- Environment: cascade order (DynamicSky writes singleton BEFORE SunDisc
  reads it), dispose idempotent, prop-body teardown.

## Deferred to a dev-server pass

Visual verify (no WebGL in jsdom) — per 014 plan Impact/Risk (lines 189-191):

- No black screen: clouds + sun-disc render through the layer-0 depth mask
  (SkyPosterize pass-through contract holds at runtime).
- Tint shift: cloud base tint visibly warms at dawn/dusk vs noon.
- Sun-disc placement: additive disc sits along the sun direction by day,
  fades at night; moon/stars (010) unaffected.
- Draw-call budget: single InstancedMesh stays ~1 cloud draw at default
  density (011 headroom).
