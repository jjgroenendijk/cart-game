# 003 Terrain height variation + closed-loop circuit

Status: open

## Context
Track is 100% flat — `tracks/TestArena.ts:35` single 400x400 box at y=0. No
heightmap, no terrain system, no Rapier heightfield. Kart game needs elevation.

## Goal
Closed-loop kart circuit (Catmull-Rom spline) on terrain with height variation:
smooth drivable corridor on-track, rolling procedural hills off-track. Visual
terrain mesh + matching Rapier heightfield collider from the SAME heightmap so
physics/visuals agree.

## Scope
- New `src/terrain/Terrain.ts`.
- `SimplexNoise` from `three/addons/math/SimplexNoise.js`.
- Heightmap fn: `height(x,z) = blend(pathHeight(x,z), noise(x,z), distToSpline)`.
  Smooth corridor within trackHalfWidth; hills beyond, falloff blend.
- `PlaneGeometry` grid displaced by heightmap; vertex colors by height/slope
  (grass/sand/rock) -> toon material (`makeToon({ vertexColors:true })`).
- Rapier `ColliderDesc.heightfield(nrows, ncols, points, scale)` from same array.
  Note Rapier heightfield expects column-major heights; verify orientation.
- Spline gives start position + yaw; relocate kart spawn onto spline.
- Replace `TestArena` usage in `Game.ts` (or repurpose). Keep boundary so kart
  can't fall off world edge.

## Risks
- Rapier heightfield orientation/scale convention — must match mesh or kart
  sinks/floats. Verify by raycast + visual.
- Noise amplitude vs drivability: corridor must stay near-flat or kart bounces.

## Acceptance
- [ ] Kart drives a closed loop w/ hills visible off-track
- [ ] Kart rests on terrain surface (no float/sink) at spawn
- [ ] typecheck clean

## Depends on
001 (toon).
