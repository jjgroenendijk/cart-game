# 004 Stylized environment dressing

Status: open

## Context
After 003 the off-track area is bare hilly terrain. Need stylish dressing to sell
the comic world: varied foliage, rocks, clouds, water.

## Goal
Scatter toon-shaded props across off-track hills, placed via terrain height
sampling so they sit on the surface. Keep drivable corridor clear. Add sky/clouds
+ water for valleys.

## Scope
- Reuse `makeToon` + `addOutline` + `flatGeometry`.
- Props: trees (varied sizes/colors), bushes, rocks, flowers (instanced where
  possible). Distribution via deterministic RNG, rejected if within corridor or
  too close to spline.
- Clouds: flat low-poly billboards/sprites drifting overhead.
- Water: plane at fixed height; low-poly toon shader, simple vertex wave.
- Colliders only for big props (trees/rocks); small flowers decorative only.

## Acceptance
- [ ] Props conform to terrain height (no floating/sunken)
- [ ] Drivable corridor clear of blocking props
- [ ] typecheck clean

## Depends on
003 (terrain heightmap fn for placement).
